#!/usr/bin/env node
/**
 * technocore-handoff.js - a signed, chained record of who proposed what.
 *
 * A transcript of agents talking to each other proves nothing. Anybody can write
 * one, in any order, after the fact. This turns the same conversation into a
 * chain where each step is signed by a DIFFERENT key and commits to the step
 * before it, so three things a transcript cannot show become checkable by a
 * stranger: which role actually said each thing, in what order, and that no step
 * was removed, reordered or edited afterwards.
 *
 * The shape it records is one prompt and then a sequence of handoffs:
 *
 *     your prompt -> planner proposes -> implementer challenges ->
 *     planner finalizes -> implementer writes code (+ a git commit) ->
 *     reviewer approves or sends it back
 *
 * Each role holds its own identity in its own folder, so "the implementer
 * challenged the plan" is a fact about a key the planner does not control,
 * rather than one program signing both halves of an argument with itself.
 *
 * Zero dependencies: four of Node's built-ins - crypto, fs, path and
 * child_process - plus the pure functions in technocore-did.js beside it.
 * Check that yourself rather than taking it from me:
 *     grep -n "^const.*require" technocore-handoff.js
 * Five lines, and the fifth is the sibling file. On Windows:
 *     findstr /r /n /c:"^const.*require" technocore-handoff.js
 *
 * This file never opens a socket and never touches a seed. It cannot: the only
 * code that can decrypt anything is technocore-did.js, which exports no way in,
 * so signing here means starting that program in the role's own folder with your
 * terminal attached and letting IT do the asking. Its prompt is on stderr and
 * its answer on stdout, which is why the passphrase you type never lands in the
 * chain file.
 *
 * Commands:
 *   node technocore-handoff.js setup                    create the three role identities
 *   node technocore-handoff.js init <chain> "<prompt>"   start a chain here
 *   node technocore-handoff.js add <role> <file>         append a signed step
 *   node technocore-handoff.js add <role> --text "<s>"   ...for a one-liner
 *   node technocore-handoff.js show                      read the chain back
 *   node technocore-handoff.js verify [chain.json]       re-check every link
 *   node technocore-handoff.js anchor <room>             publish the head
 *
 * chain.json is public: it holds hashes, DIDs and signatures, never a key. The
 * step texts live beside it in steps/ and are hashed into the chain, so you can
 * publish both and let anyone re-derive the head for themselves.
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const tc = require('./technocore-did.js');

// The frame prefix is versioned the same way the checkpoint frames are, so a
// reader can tell at a glance which rules a line was written under. Bump it if
// the canonical string below ever changes shape: two incompatible formats under
// one name is how a verifier ends up calling a good chain broken.
const FRAME = 'tchx1';
const ROLES = ['planner', 'implementer', 'reviewer'];
const AGENTS_DIR = 'agents';
const STEPS_DIR = 'steps';
const CHAIN_FILE = 'chain.json';
const SIGNER = path.join(__dirname, 'technocore-did.js');
const HEX64 = /^[0-9a-f]{64}$/;
const COMMIT_RE = /^[0-9a-f]{7,40}$/;
const NONE = '-';

function sha256hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function die(msg, ...lines) {
  console.error('\nrefused: ' + msg);
  for (const l of lines) console.error('  ' + l);
  process.exit(1);
}

function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') throw new Error(`${file} not found`);
    throw new Error(`${file} is not readable JSON: ${e.message}`);
  }
}

// Step 1 has no step before it, so its "prev" is derived from the prompt itself
// rather than being a row of zeros. That makes the prompt part of the chain: edit
// the goal after the fact and every signature downstream stops lining up, which
// is the property you want when the whole point is what was asked for.
function genesisLink(chain, promptSha) {
  return sha256hex(tc.canonical(FRAME, chain, 'genesis', promptSha));
}

// Every field here is a name, a decimal number, a did:key or hex, and none of
// them can contain "|" - so joining with "|" needs no escaping and a reader can
// split the whole thing back apart from the left without ambiguity. The signer's
// own DID is inside the string it signs, which is what stops a step from being
// lifted out of one role's slot and replayed in another's.
function canonicalStep(s) {
  return tc.canonical(
    FRAME, s.chain, String(s.n), s.role, s.did, s.prev, s.text_sha256, s.commit || NONE
  );
}

// What the NEXT step commits to: the exact string that was signed, and the
// signature over it. Hashing both means a step cannot be re-signed by another
// key without breaking the link, which a hash of the text alone would allow.
function linkOf(step) {
  return sha256hex(canonicalStep(step) + '\n' + step.sig);
}

// ------------------------------------------------------------ role identities --
function roleDir(role) {
  return path.join(process.cwd(), AGENTS_DIR, role);
}

function didOfRole(role) {
  const file = path.join(roleDir(role), 'did.json');
  const parsed = readJsonFile(file);
  const d = String(parsed && parsed.did ? parsed.did : '');
  tc.rawPublicFromDid(d); // throws on anything that is not an Ed25519 did:key
  return d;
}

/**
 * Sign a string as one role, by starting technocore-did.js inside that role's
 * folder. stdin is inherited so its raw-mode passphrase reader still has a real
 * terminal to read from; stderr is inherited so you see the prompt and the
 * asterisks; only stdout is captured, and stdout carries nothing but the JSON.
 * Nothing about the passphrase or the seed passes through this process.
 */
function signAs(role, message) {
  const dir = roleDir(role);
  if (!fs.existsSync(path.join(dir, 'seed.enc'))) {
    die(`there is no identity for "${role}".`,
      `expected ${path.join(dir, 'seed.enc')}`,
      'run "node technocore-handoff.js setup" first.');
  }
  process.stderr.write(`\n${role} is signing. Passphrase for ${role}:\n`);
  const run = spawnSync(process.execPath, [SIGNER, 'sign', message], {
    cwd: dir,
    stdio: ['inherit', 'pipe', 'inherit'],
    encoding: 'utf8',
  });
  if (run.error) die(`could not start node: ${run.error.message}`);
  if (run.status !== 0) die(`${role} did not sign.`, 'the error above came from technocore-did.js.');
  let out;
  try {
    out = JSON.parse(run.stdout);
  } catch (e) {
    die('the signer did not return JSON.', `got: ${JSON.stringify(String(run.stdout).slice(0, 80))}`);
  }
  if (out.message !== message) {
    die('the signer signed a different string than the one asked for.',
      'refusing to record a signature over text this program cannot account for.');
  }
  const declared = didOfRole(role);
  if (out.did !== declared) {
    die(`the ${role} folder signed as a different identity than its did.json claims.`,
      `did.json says  ${declared}`,
      `the seed gave  ${out.did}`);
  }
  return { did: out.did, sig: out.signature_wire };
}

// ------------------------------------------------------------------ commands --
function cmdSetup() {
  console.log('Three identities, one per role, each in its own folder.\n');
  console.log('You will be asked for a passphrase twice per role. Using the SAME passphrase');
  console.log('for all three is reasonable: these keys sign opinions, not money, and a');
  console.log('passphrase you cannot reproduce is how a chain becomes unfinishable.\n');
  for (const role of ROLES) {
    const dir = roleDir(role);
    if (fs.existsSync(path.join(dir, 'did.json'))) {
      console.log(`${role.padEnd(12)} already exists  ${didOfRole(role)}`);
      continue;
    }
    fs.mkdirSync(dir, { recursive: true });
    console.log(`\n--- ${role} ---`);
    const run = spawnSync(process.execPath, [SIGNER, 'new'], { cwd: dir, stdio: 'inherit' });
    if (run.error) die(`could not start node: ${run.error.message}`);
    if (run.status !== 0) die(`${role} was not created.`, 'the error above came from technocore-did.js.');
  }
  console.log('\nThe three roles:\n');
  for (const role of ROLES) console.log(`  ${role.padEnd(12)} ${didOfRole(role)}`);
  console.log(`\nEach ${AGENTS_DIR}/<role>/seed.enc is a real identity - the repo .gitignore already`);
  console.log('excludes seed.enc everywhere, so none of them can be committed by accident.');
}

function cmdInit(chain, prompt) {
  if (typeof prompt !== 'string') throw new Error('usage: init <chain> "<the prompt you started from>"');
  tc.checkName('chain', chain);
  if (fs.existsSync(CHAIN_FILE)) {
    die(`${CHAIN_FILE} already exists in this folder.`,
      'a chain is append-only; move it aside to start a different one.');
  }
  const clean = tc.sweep(prompt);
  if (clean === '') throw new Error('the prompt is empty once swept');
  const roles = {};
  for (const role of ROLES) roles[role] = didOfRole(role);
  const promptSha = sha256hex(Buffer.from(clean, 'utf8'));
  const chainDoc = {
    frame: FRAME,
    chain,
    started: new Date().toISOString(),
    prompt: clean,
    prompt_sha256: promptSha,
    // Captured once, here. A step signed by a key that is not the one this role
    // declared at the start is a different actor wearing the same name, and
    // verify treats it as a failure rather than a curiosity.
    roles,
    steps: [],
  };
  fs.mkdirSync(STEPS_DIR, { recursive: true });
  fs.writeFileSync(CHAIN_FILE, JSON.stringify(chainDoc, null, 2) + '\n');
  console.log(`chain      ${chain}`);
  console.log(`prompt     ${JSON.stringify(clean)}`);
  console.log(`sha256     ${promptSha}`);
  console.log(`first prev ${genesisLink(chain, promptSha)}   (derived from the prompt)`);
  console.log(`\nWritten ${CHAIN_FILE} and ${STEPS_DIR}${path.sep}. Put each role's output in a file under`);
  console.log(`${STEPS_DIR}${path.sep} and append it with "add <role> <file>".`);
}

/**
 * A step's text is hashed as UTF-8 with LF line endings and no byte-order mark,
 * whatever the file on disk happens to hold. That is not tidiness: this repo
 * checks out with CRLF on Windows and LF everywhere else, so hashing the raw
 * bytes would make the same chain verify on one machine and fail on another.
 * Normalizing first means the hash describes the text, not the checkout.
 */
function readStepText(file) {
  let raw;
  try {
    raw = fs.readFileSync(file);
  } catch (e) {
    if (e.code === 'ENOENT') die(`there is no file at ${file}.`, 'put the role output in a file first, or use --text for a one-liner.');
    throw e;
  }
  if (raw.length >= 2 && ((raw[0] === 0xff && raw[1] === 0xfe) || (raw[0] === 0xfe && raw[1] === 0xff))) {
    die(`${file} is UTF-16, not UTF-8.`,
      'PowerShell writes UTF-16 with some redirections. Re-save it as UTF-8:',
      `  Get-Content ${file} | Set-Content -Encoding utf8 ${file}.utf8`);
  }
  let text = raw.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip a UTF-8 BOM
  return text.replace(/\r\n/g, '\n');
}

/**
 * A commit id is only worth recording if it exists, so this asks git rather than
 * trusting the argument. Refusing is the right answer when git cannot confirm it:
 * a chain that points at a commit nobody can resolve is weaker than one that
 * admits it has no commit at all.
 */
function resolveCommit(sha) {
  if (!COMMIT_RE.test(String(sha))) {
    die(`"${sha}" is not a commit id.`, 'expected 7 to 40 lowercase hex characters.');
  }
  const run = spawnSync('git', ['rev-parse', '--verify', `${sha}^{commit}`], { encoding: 'utf8' });
  if (run.error) {
    die('git is not available, so that commit cannot be confirmed.',
      'install git, or leave --commit off and record the step without it.');
  }
  if (run.status !== 0) {
    die(`git cannot find a commit ${sha} in this repository.`,
      'commit the work first, then record the step against the id git prints.',
      `git said: ${String(run.stderr).trim().split('\n')[0]}`);
  }
  return String(run.stdout).trim();
}

/**
 * Pull the text, its source name and an optional commit out of the arguments
 * after the role. A file and --text are mutually exclusive on purpose: if both
 * were allowed, one of them would silently lose, and "which of the two did it
 * actually sign?" is not a question a signature should leave open.
 */
function parseAddArgs(rest) {
  let text = null;
  let source = null;
  let commit = null;
  const taken = () => {
    if (text !== null) die('give either a file or --text, not both.', 'a step records exactly one text.');
  };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--text' || a === '--commit') {
      const v = rest[i + 1];
      if (v === undefined) die(`${a} needs a value after it.`);
      i++;
      if (a === '--commit') {
        commit = resolveCommit(v);
      } else {
        taken();
        text = tc.sweep(v);
        source = NONE;
      }
    } else if (a.startsWith('--')) {
      die(`I do not know the option ${a}.`,
        'the options are --text "<one line>" and --commit <sha>.');
    } else {
      taken();
      text = readStepText(a);
      source = path.basename(a);
    }
  }
  return { text, source, commit };
}

// The one signature check in this file, used both when appending a step and when
// re-checking a chain from someone else. Ed25519 needs no digest argument, hence
// the null: the algorithm hashes internally, so passing one would be an error.
function sigOk(did, message, sig) {
  try {
    return crypto.verify(
      null,
      Buffer.from(message, 'utf8'),
      tc.publicKeyFromRaw(tc.rawPublicFromDid(did)),
      tc.sigDecode(sig)
    );
  } catch (e) {
    return false; // an unparseable DID or signature is a failed check, not a crash
  }
}

/**
 * Append one signed step. The order matters: build the step, have the role's own
 * folder sign the canonical string, then verify that signature here before
 * anything reaches the disk. chain.json is append-only, so a step that would
 * fail verify must never be written in the first place - a chain you have to
 * repair by hand is a chain nobody else can trust.
 */
function cmdAdd(args) {
  const role = args[0];
  if (!role) throw new Error('usage: add <role> <file> [--commit <sha>]');
  const doc = readChain();
  const declared = doc.roles && doc.roles[role];
  if (!declared) {
    die(`"${role}" is not a role in this chain.`,
      `${CHAIN_FILE} declares: ${Object.keys(doc.roles || {}).join(', ') || '(none)'}`);
  }
  // The folder must still hold the key it declared at init. If it does not, this
  // is a different actor wearing an old name; saying so now beats writing a step
  // that every later verify will reject.
  const current = didOfRole(role);
  if (current !== declared) {
    die(`the ${role} folder no longer holds the key this chain started with.`,
      `${CHAIN_FILE} expects  ${declared}`,
      `the folder holds   ${current}`,
      'a chain is append-only: start a new one rather than swapping keys mid-way.');
  }

  const { text, source, commit } = parseAddArgs(args.slice(1));
  if (text === null) {
    throw new Error('usage: add <role> <file> [--commit <sha>]   or   add <role> --text "<one line>"');
  }
  if (text.trim() === '') die('that step has no text.', 'a signature over nothing records nothing.');

  const n = doc.steps.length + 1;
  const step = {
    n,
    role,
    did: declared,
    at: new Date().toISOString(),
    source,
    bytes: Buffer.byteLength(text, 'utf8'),
    text_sha256: sha256hex(Buffer.from(text, 'utf8')),
    commit: commit || null,
    prev: n === 1 ? genesisLink(doc.chain, doc.prompt_sha256) : linkOf(doc.steps[n - 2]),
    chain: doc.chain,
    signed: null,
    sig: null,
  };
  const message = canonicalStep(step);
  const { did, sig } = signAs(role, message);
  step.did = did;
  step.sig = sig;
  step.signed = message;
  if (!sigOk(did, message, sig)) {
    die('the signature I just received does not verify against the DID that made it.',
      'nothing has been written. This should be impossible; do not work around it.');
  }
  doc.steps.push(step);
  fs.writeFileSync(CHAIN_FILE, JSON.stringify(doc, null, 2) + '\n');
  console.log(`\nstep ${n}      ${role}`);
  console.log(`text       ${step.bytes} bytes  sha256 ${step.text_sha256}`);
  if (step.commit) console.log(`commit     ${step.commit}`);
  console.log(`prev       ${step.prev}`);
  console.log(`head       ${linkOf(step)}`);
  console.log(`\nAppended to ${CHAIN_FILE}. "verify" re-checks the whole chain.`);
}

// Every command but setup and init needs the chain file. Saying only "not found"
// is accurate and useless: the likely cause is being in the wrong folder, or not
// having started a chain here yet, so say both.
function readChain(file) {
  const f = file || CHAIN_FILE;
  if (!fs.existsSync(f)) {
    die(`there is no ${path.basename(f)} here.`,
      `you are in ${process.cwd()}`,
      'either you are in the wrong folder, or this chain has not been started yet:',
      `  node ${path.basename(__filename)} init <chain> "<the prompt you started from>"`);
  }
  return readJsonFile(f);
}

// A DID is 56 characters and three of them per line makes a table unreadable, so
// show enough to tell the three roles apart and leave the full value in the file.
function shortDid(did) {
  const s = String(did);
  return s.length > 24 ? `${s.slice(0, 17)}…${s.slice(-4)}` : s;
}

function cmdShow() {
  const doc = readChain();
  console.log(`\nchain      ${doc.chain}   (frame ${doc.frame})`);
  console.log(`started    ${doc.started}`);
  console.log(`prompt     ${JSON.stringify(doc.prompt)}`);
  console.log(`           sha256 ${doc.prompt_sha256}`);
  console.log('\nroles');
  for (const role of Object.keys(doc.roles || {})) {
    console.log(`  ${role.padEnd(12)} ${doc.roles[role]}`);
  }
  if (!doc.steps.length) {
    console.log(`\nNo steps yet. First prev would be ${genesisLink(doc.chain, doc.prompt_sha256)}`);
    return;
  }
  console.log(`\n${doc.steps.length} step${doc.steps.length === 1 ? '' : 's'}\n`);
  for (const s of doc.steps) {
    console.log(`  ${String(s.n).padStart(2)}. ${s.role.padEnd(12)} ${shortDid(s.did)}  ${s.at}`);
    const where = s.source && s.source !== NONE ? `${STEPS_DIR}${path.sep}${s.source}` : '--text';
    console.log(`      text     ${where}  ${s.bytes} bytes`);
    if (s.commit) console.log(`      commit   ${s.commit}`);
  }
  console.log(`\nhead       ${linkOf(doc.steps[doc.steps.length - 1])}`);
  console.log('That head is what "anchor" publishes and what "verify" re-derives.');
}

/**
 * Every check one step has to pass, gathered rather than thrown, so a broken
 * chain reports all of its problems in one run instead of one per invocation.
 * `expectedPrev` is computed by the caller from the step before, which is what
 * makes a removed or reordered step visible here.
 */
function verifyStep(doc, s, expectedPrev) {
  const bad = [];
  if (s.chain !== doc.chain) bad.push(`chain is "${s.chain}", not "${doc.chain}"`);
  if (!HEX64.test(String(s.text_sha256))) bad.push('text_sha256 is not 64 hex characters');
  if (!HEX64.test(String(s.prev))) bad.push('prev is not 64 hex characters');
  const declared = doc.roles && doc.roles[s.role];
  if (!declared) bad.push(`role "${s.role}" is not one this chain declared`);
  else if (s.did !== declared) {
    bad.push(`signed by ${s.did}, but this chain declared ${declared} as ${s.role}`);
  }
  if (s.commit != null && !COMMIT_RE.test(String(s.commit))) bad.push(`commit "${s.commit}" is not hex`);
  // The recorded string is not trusted: it has to be the one these fields imply.
  // Otherwise a step could carry a valid signature over some other text entirely.
  const rebuilt = canonicalStep(s);
  if (s.signed !== rebuilt) {
    bad.push('the signed string does not match this step\'s own fields');
    bad.push(`  recorded  ${JSON.stringify(String(s.signed))}`);
    bad.push(`  rebuilt   ${JSON.stringify(rebuilt)}`);
  }
  // Wire form matters: the server takes 86 unpadded base64url characters, and a
  // re-encode that differs means the same 64 bytes were written a second way.
  try {
    if (tc.sigEncode(tc.sigDecode(s.sig)) !== s.sig) bad.push('the signature is not in canonical wire form');
  } catch (e) {
    bad.push(`the signature is unusable: ${e.message}`);
  }
  if (!sigOk(s.did, rebuilt, s.sig)) bad.push('the signature does not verify against that DID');
  if (s.prev !== expectedPrev) {
    bad.push('prev does not match the step before it - something was changed, removed or reordered');
    bad.push(`  recorded  ${s.prev}`);
    bad.push(`  expected  ${expectedPrev}`);
  }
  // The text is hashed into the chain but stored beside it, so a missing file
  // weakens the record without breaking it. Say which of the two happened. A
  // --text step has no file by design and loses nothing: its hash is inside the
  // signed string either way.
  let note = 'inline, covered by the signature';
  if (s.source && s.source !== NONE) {
    const file = path.join(STEPS_DIR, s.source);
    if (!fs.existsSync(file)) note = `${s.source} is missing, hash unchecked`;
    else {
      const h = sha256hex(Buffer.from(readStepText(file), 'utf8'));
      if (h === s.text_sha256) note = `${s.source} matches`;
      else {
        note = `${s.source} DOES NOT MATCH`;
        bad.push(`the text in ${file} hashes to ${h}, not ${s.text_sha256}`);
      }
    }
  }
  return { bad, note };
}

/**
 * Re-check a chain from the file alone - yours or a stranger's. Nothing here
 * needs a key, a network or this machine's history, which is the whole point:
 * the claim "these roles said these things in this order" has to be checkable by
 * someone who was not present and does not trust whoever hands them the file.
 */
function cmdVerify(file) {
  const target = path.resolve(file || CHAIN_FILE);
  // steps/ lives beside the chain file, so work from there rather than from
  // wherever the command happened to be typed.
  process.chdir(path.dirname(target));
  const doc = readChain(path.basename(target));
  let fails = 0;
  const chainBad = [];
  if (doc.frame !== FRAME) {
    chainBad.push(`frame is "${doc.frame}", and this program only knows "${FRAME}"`);
  }
  try {
    tc.checkName('chain', doc.chain);
  } catch (e) {
    chainBad.push(e.message);
  }
  if (sha256hex(Buffer.from(String(doc.prompt), 'utf8')) !== doc.prompt_sha256) {
    chainBad.push('the prompt does not hash to prompt_sha256 - the goal was edited after the fact');
  }
  const dids = Object.values(doc.roles || {});
  if (new Set(dids).size !== dids.length) {
    chainBad.push('two roles share one DID, so their steps are not independent');
  }
  for (const role of Object.keys(doc.roles || {})) {
    try {
      tc.rawPublicFromDid(doc.roles[role]);
    } catch (e) {
      chainBad.push(`the ${role} DID is not an Ed25519 did:key: ${e.message}`);
    }
  }
  console.log(`\nchain      ${doc.chain}   frame ${doc.frame}`);
  console.log(`prompt     ${doc.prompt_sha256}`);
  for (const b of chainBad) console.log(`  FAIL     ${b}`);
  fails += chainBad.length;

  let prev = genesisLink(doc.chain, doc.prompt_sha256);
  console.log('\n   #  role          link+signature  text');
  const steps = Array.isArray(doc.steps) ? doc.steps : [];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const { bad, note } = verifyStep(doc, s, prev);
    if (s.n !== i + 1) bad.unshift(`this is step ${i + 1} of the file but calls itself ${s.n}`);
    // One verdict per step. Splitting it into per-check columns would suggest the
    // checks are independent, and they are not: a bad link invalidates the rest.
    const mark = bad.length ? 'FAIL' : 'ok';
    console.log(`  ${String(i + 1).padStart(2)}  ${String(s.role).padEnd(12)}  ${mark.padEnd(14)}  ${note}`);
    for (const b of bad) console.log(`      ${b}`);
    fails += bad.length;
    prev = linkOf(s);
  }
  return { doc, steps, fails, head: steps.length ? prev : null };
}

function cmdVerifyCli(file) {
  const { steps, fails, head } = cmdVerify(file);
  if (fails) {
    console.log(`\n${fails} problem${fails === 1 ? '' : 's'}. This chain is NOT intact.`);
    process.exitCode = 1;
    return;
  }
  console.log(`\n${steps.length} step${steps.length === 1 ? '' : 's'}, every link and signature checks out.`);
  if (head) console.log(`head       ${head}`);
  console.log('\nWhat that means, and only this: each step was signed by the key its role');
  console.log('declared at the start, in this order, with nothing removed or edited since.');
  console.log('It says nothing about whether the plan was any good.');
  console.log('\nOne edit this cannot see: steps dropped from the END. A shorter chain still');
  console.log('links up perfectly, because nothing after the cut is left to contradict it.');
  console.log('That is what "anchor" is for - once a head is published with a timestamp, a');
  console.log(`truncated chain has a different head and anyone can see it. Compare: ${head ? head.slice(0, 12) : ''}…`);
}

/**
 * Publish the head. Technocore caps a message at MAX_TEXT characters, so the
 * chain itself cannot go in a record - and should not: a digest that a reader can
 * re-derive from the file is a stronger claim than a wall of text they have to
 * take on faith. Once the head is in a room with a timestamp, the chain can no
 * longer be rewritten quietly, because the old head is already public.
 */
function cmdAnchor(room) {
  if (!room) throw new Error('usage: anchor <room>');
  tc.checkName('room', room);
  const { doc, steps, fails, head } = cmdVerify();
  if (fails) {
    die('this chain does not verify, so there is nothing worth anchoring.',
      'fix the problems above first - publishing a broken head only spreads it.');
  }
  if (!steps.length) die('this chain has no steps yet.');
  const frame = `${FRAME} c=${doc.chain} n=${steps.length} head=${head}`;
  if (frame.length > tc.MAX_TEXT) die(`the frame is ${frame.length} characters and the cap is ${tc.MAX_TEXT}.`);
  console.log(`\nframe      ${frame}`);
  console.log(`           ${frame.length} characters, cap ${tc.MAX_TEXT}\n`);
  console.log('Post it from whichever identity should own the anchor. From this folder,');
  console.log('the reviewer is the natural one - it signed last:\n');
  console.log(`  cd ${path.join(AGENTS_DIR, 'reviewer')}`);
  // The absolute path, not a relative one: a chain usually lives in its own
  // folder somewhere else, so "..\..\technocore-did.js" would point at nothing.
  console.log(`  node "${SIGNER}" say ${room} "${frame}"`);
  console.log('\nThat prints a URL to open. Anyone who later holds this chain can re-derive');
  console.log('the same head with "verify" and compare it to what the room stored.');
}

// ---------------------------------------------------------------- dispatch --
const USAGE = `
technocore-handoff.js - a signed, chained record of who proposed what.

  setup                              create ${AGENTS_DIR}/<role>/ for each of the three roles
  init <chain> "<prompt>"            start a chain in this folder from that prompt
  add <role> <file> [--commit <sha>] append a step, signed by that role
  add <role> --text "<s>" [--commit <sha>]
  show                               read ${CHAIN_FILE} back
  verify [${CHAIN_FILE}]                re-check every link and signature
  anchor <room>                      print the head, ready to publish

  roles      ${ROLES.join(', ')}
  the shape  prompt -> plan -> challenge -> final plan -> code (+commit) -> review

Run it in a folder of its own, NOT inside another project: init writes
${CHAIN_FILE} and ${STEPS_DIR}${path.sep} here, and setup writes ${AGENTS_DIR}${path.sep} here.
`;

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case 'setup':
      return cmdSetup();
    case 'init':
      return cmdInit(rest[0], rest[1]);
    case 'add':
      return cmdAdd(rest);
    case 'show':
      return cmdShow();
    case 'verify':
      return cmdVerifyCli(rest[0]);
    case 'anchor':
      return cmdAnchor(rest[0]);
    default:
      console.log(USAGE);
      // An unrecognised command is a failure, not a help request: a script that
      // typos "verfiy" and reads exit 0 as a pass is worse than one that stops.
      if (cmd !== undefined) {
        console.error(`refused: I do not know the command "${cmd}".`);
        process.exitCode = 1;
      }
  }
}

main().catch((e) => die(e.message));

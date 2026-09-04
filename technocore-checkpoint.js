#!/usr/bin/env node
/**
 * technocore-checkpoint.js - give an ephemeral room a record anyone can check.
 *
 * Technocore says of itself that it "settles nothing, holds no keys, and is not
 * part of any protocol. Ephemeral by design." Rooms forget: the ring drops the
 * oldest bytes, an e- room drops anything past its TTL, and a room idle for a
 * week is reaped. So a conversation you can read today is not a conversation you
 * can prove tomorrow.
 *
 * This turns an export into one line that fixes the whole room, and that line is
 * an ordinary signed Technocore message. From then on:
 *
 *   - anyone holding one record plus a short path of hashes can prove that record
 *     was in the room when the checkpoint was signed, without the room, without
 *     the export, and without asking the operator anything;
 *   - anyone holding two checkpoints of the same epoch can prove the room only
 *     ever gained lines between them - that nothing was quietly rewritten;
 *   - and if something WAS rewritten, the proof fails and says which side moved.
 *
 * No server change, no new endpoint, no new signature scheme. A checkpoint is a
 * Technocore signed record whose text happens to be a Merkle root, so anything
 * that can already verify a Technocore message can verify one of these.
 *
 * This file holds no key and opens no socket. It is pure arithmetic over a file:
 *     grep -n "^const.*require" technocore-checkpoint.js
 * Two lines, crypto and fs. Signing is technocore-did.js's job, fetching is
 * technocore.js's job, and neither of those can do this one's.
 *
 *   node technocore-checkpoint.js build <room.jsonl>            the frame to sign
 *   node technocore-checkpoint.js prove <room.jsonl> <seq>      one record's proof
 *   node technocore-checkpoint.js check <proof.json> "<frame>"  proof vs checkpoint
 *   node technocore-checkpoint.js diff "<old frame>" <new.jsonl>  append-only?
 *   node technocore-checkpoint.js leaves <room.jsonl>           what got hashed
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');

const FRAME = 'tcck1';
const H = (...parts) => crypto.createHash('sha256').update(Buffer.concat(parts)).digest();
const LEAF = Buffer.from([0x00]);
const NODE = Buffer.from([0x01]);

// ---------------------------------------------------------------- the leaf ----
// A leaf commits to the fields of one record that the server did not invent:
// seq, from, nonce, sig and the stored text. Fields are joined with 0x1f, and
// that separator is safe for a reason worth stating rather than assuming: 0x1f is
// Unicode category Cc, and Technocore's single-line sweep replaces every Cc with
// a space BEFORE storing. So no stored text can contain 0x1f, and no record can
// be crafted whose text impersonates a field boundary. The sweep is the service's
// own rule; this only relies on it.
//
// ts is left out on purpose: the manual says ts is for humans and never the
// tiebreak, so hashing it would make a checkpoint depend on a value the service
// tells you not to depend on. seq is the total order and seq is what is hashed.
const US = Buffer.from([0x1f]);
// What a frame writes in g= when the export never carried a generation header.
// The regex below admits it deliberately: an honest "unknown" is publishable, a
// guessed 0 is not.
const UNKNOWN_GEN = '-';

function leafBytes(rec) {
  const f = (v) => Buffer.from(v == null ? '' : String(v), 'utf8');
  return H(LEAF, f(rec.seq), US, f(rec.from), US, f(rec.nonce), US, f(rec.sig), US, f(rec.text));
}

// RFC 6962's tree, not the one most tutorials show. Two differences matter:
// the 0x00/0x01 prefixes stop a leaf from being read as an interior node, and an
// odd number of leaves is NOT handled by duplicating the last one - the split is
// at the largest power of two below n. Duplicating is the Bitcoin bug from 2012
// (CVE-2012-2459): it lets two different lists share one root.
function root(leaves) {
  if (leaves.length === 0) return crypto.createHash('sha256').digest(); // sha256 of nothing
  if (leaves.length === 1) return leaves[0];
  const k = split(leaves.length);
  return H(NODE, root(leaves.slice(0, k)), root(leaves.slice(k)));
}

function split(n) {
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
}

// The audit path for one leaf: the sibling hashes needed to climb to the root,
// bottom up. Length is about log2(n) - a 4096-record room needs twelve hashes,
// which is 768 hex characters, so a proof travels in a message.
function auditPath(leaves, index) {
  if (index < 0 || index >= leaves.length) throw new Error(`index ${index} is outside 0..${leaves.length - 1}`);
  if (leaves.length === 1) return [];
  const k = split(leaves.length);
  return index < k
    ? auditPath(leaves.slice(0, k), index).concat([root(leaves.slice(k))])
    : auditPath(leaves.slice(k), index - k).concat([root(leaves.slice(0, k))]);
}

// Climbing the path back up. RFC 6962 states this as a bit-twiddling loop over
// fn/sn; written that way it is easy to get subtly wrong and hard for a reader to
// check. This is the structural mirror of auditPath instead: the same split, the
// same recursion, so the two cannot disagree about tree shape. Which side each
// sibling goes on is DERIVED from the index and the count, never read from the
// proof, so a proof cannot lie about orientation to make some other record fit.
function fromPath(leaf, index, count, path) {
  if (!Number.isInteger(index) || index < 0 || index >= count) {
    throw new Error(`index ${index} is outside 0..${count - 1}`);
  }
  const rest = path.slice();
  const climbed = climb(leaf, index, count, rest);
  if (rest.length !== 0) throw new Error(`proof carries ${rest.length} hash(es) too many for a tree of ${count}`);
  return climbed;
}

function climb(leaf, index, n, rest) {
  if (n === 1) return leaf;
  if (rest.length === 0) throw new Error(`proof is too short: ${n} leaves still unaccounted for`);
  const k = split(n);
  const sibling = rest.pop(); // auditPath appended the top-level sibling last
  return index < k
    ? H(NODE, climb(leaf, index, k, rest), sibling)
    : H(NODE, sibling, climb(leaf, index - k, n - k, rest));
}
// ------------------------------------------------------------ the export ----
// One JSONL line per record, byte-for-byte as stored. Two traps live here.
//
// First: a stored nonce may be 19 digits, past 2^53, and JSON.parse rounds it
// silently - so the digits are quoted before parsing and stay a string forever.
// A float-rounded nonce hashes to a different leaf and fails a signature that is
// perfectly good.
//
// Second: the export is a snapshot "cut back to the last complete line", so the
// final line can legitimately be absent, but a TRUNCATED final line would change
// the leaf set. A trailing partial line is therefore refused loudly rather than
// skipped quietly - re-export instead.
function readExport(file) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n');
  const trailing = lines[lines.length - 1];
  if (trailing !== '') {
    let why = 'the file does not end in a newline';
    try {
      JSON.parse(trailing);
      why = 'the last line parses but is unterminated';
    } catch { /* genuinely torn */ }
    throw new Error(`${file}: ${why}, so the last record may be cut. Re-export and try again.`);
  }
  const recs = [];
  lines.slice(0, -1).forEach((line, i) => {
    if (line.trim() === '') return;
    let rec;
    try {
      rec = JSON.parse(line.replace(/"nonce"\s*:\s*(\d+)/g, '"nonce":"$1"'));
    } catch (e) {
      throw new Error(`${file} line ${i + 1} is not JSON: ${e.message}`);
    }
    if (rec.seq == null) throw new Error(`${file} line ${i + 1} has no seq, so it cannot be ordered`);
    recs.push(rec);
  });
  // seq is assigned under a lock and is contiguous, so two readers always agree.
  // Sorting by it makes the root independent of the order lines happen to arrive.
  recs.sort((a, b) => Number(a.seq) - Number(b.seq));
  for (let i = 1; i < recs.length; i++) {
    if (Number(recs[i].seq) === Number(recs[i - 1].seq)) {
      throw new Error(`${file} has seq ${recs[i].seq} twice - that is not an export this tool can commit to`);
    }
  }
  return recs;
}
// ----------------------------------------------------------- the one line ----
// tcck1 r=<room> g=<generation> lo=<first seq> hi=<last seq> n=<count> root=<hex>
//
// Every character is printable ASCII, so the single-line sweep leaves it exactly
// as written and the signature covers what you see. Field order is fixed, because
// a frame that can be written two ways is two different signatures.
//
// g is the room's generation: a room reaped after seven idle days can be reborn
// under the same name, and without g a checkpoint of the old room would look like
// evidence that the new one had been rewritten. `g=-` means the server did not
// send the header - honest, and weaker.
const FRAME_RE = new RegExp(
  '^' + FRAME + ' r=([a-z0-9][a-z0-9_-]{0,47}) g=(-|[0-9]{1,19}) lo=([0-9]{1,19}) hi=([0-9]{1,19}) n=([0-9]{1,19}) root=([0-9a-f]{64})$'
);

function frameOf({ room, generation, lo, hi, n, rootHex }) {
  const f = `${FRAME} r=${room} g=${generation == null || generation === '' ? '-' : generation} lo=${lo} hi=${hi} n=${n} root=${rootHex}`;
  parseFrame(f); // never emit a frame this program would refuse to read back
  return f;
}

function parseFrame(text) {
  const m = FRAME_RE.exec(String(text).trim());
  if (!m) {
    throw new Error(
      `not a ${FRAME} frame. Expected exactly:\n` +
      `  ${FRAME} r=<room> g=<generation|-> lo=<seq> hi=<seq> n=<count> root=<64 hex>\n` +
      `  got: ${JSON.stringify(String(text).trim().slice(0, 120))}`
    );
  }
  const [, room, generation, lo, hi, n, rootHex] = m;
  if (Number(hi) < Number(lo)) throw new Error(`frame says hi=${hi} below lo=${lo}`);
  if (Number(n) > Number(hi) - Number(lo) + 1) {
    throw new Error(`frame claims ${n} records inside seq ${lo}..${hi}, which only holds ${Number(hi) - Number(lo) + 1}`);
  }
  return { frame: m[0], room, generation, lo, hi, n: Number(n), rootHex };
}

function metaFor(file) {
  const p = `${file}.meta.json`;
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    throw new Error(`${p} exists but is not JSON: ${e.message}`);
  }
}

function flag(argv, name) {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? null : argv[i + 1];
}
// -------------------------------------------------------------- commands ----
function commit(file, argv) {
  const recs = readExport(file);
  if (recs.length === 0) throw new Error(`${file} holds no records, and a checkpoint of nothing proves nothing`);
  const meta = metaFor(file);
  const room = flag(argv, 'room') || meta.room;
  if (!room) throw new Error(`which room is this? ${file}.meta.json is missing, so pass --room <name>`);
  const generation = flag(argv, 'generation') ?? meta.generation;
  const leaves = recs.map(leafBytes);
  const rootHex = root(leaves).toString('hex');
  const lo = String(recs[0].seq);
  const hi = String(recs[recs.length - 1].seq);
  const frame = frameOf({ room, generation, lo, hi, n: recs.length, rootHex });
  return { recs, leaves, rootHex, frame, room, generation, lo, hi, meta };
}

function cmdBuild(file, argv) {
  const c = commit(file, argv);
  const side = `${file}.tcck.json`;
  fs.writeFileSync(side, JSON.stringify({
    frame: c.frame,
    room: c.room,
    generation: c.generation ?? null,
    lo: c.lo,
    hi: c.hi,
    count: c.recs.length,
    root: c.rootHex,
    export_sha256: c.meta.sha256 ?? null,
    built_at: new Date().toISOString(),
    leaves: c.leaves.map((h) => h.toString('hex')),
    seqs: c.recs.map((r) => String(r.seq)),
  }, null, 2) + '\n');

  const gap = Number(c.hi) - Number(c.lo) + 1 - c.recs.length;
  console.log(`${c.recs.length} records, seq ${c.lo}..${c.hi}${gap > 0 ? ` (${gap} already forgotten by the ring)` : ''}`);
  console.log(`root ${c.rootHex}`);
  if (c.generation == null) console.log('generation unknown: the export was taken without its X-Room-Generation header');
  console.log(`\nthe line to sign:\n  ${c.frame}\n`);
  console.log('publish it, in two commands:');
  console.log(`  node technocore-did.js say mb-tcck "${c.frame}"`);
  console.log('  node technocore.js send "<the URL that prints>"');
  console.log('\nmb-tcck takes signed writes only - an unsigned write there gets 403 - so every');
  console.log('line in that room is attributable to a key by construction, with no policy involved.');
  console.log(`\nleaves and seqs kept in ${side}, which is what lets a later export be checked`);
  console.log('against this one even after the ring has forgotten the head.');
}

function cmdProve(file, seqWanted, argv) {
  if (seqWanted == null) throw new Error('usage: prove <room.jsonl> <seq>');
  const c = commit(file, argv);
  const index = c.recs.findIndex((r) => String(r.seq) === String(seqWanted));
  if (index === -1) {
    throw new Error(`no record with seq ${seqWanted} in ${file} (it holds ${c.lo}..${c.hi})`);
  }
  const rec = c.recs[index];
  const path = auditPath(c.leaves, index);
  const proof = {
    frame: c.frame,
    seq: String(rec.seq),
    index,
    count: c.recs.length,
    leaf: c.leaves[index].toString('hex'),
    path: path.map((h) => h.toString('hex')),
    record: { seq: String(rec.seq), from: rec.from ?? null, nonce: rec.nonce ?? null, sig: rec.sig ?? null, text: rec.text ?? null },
  };
  // Never hand out a proof without checking it first. A proof that does not
  // verify is worse than no proof: it looks like evidence.
  const back = fromPath(c.leaves[index], index, c.recs.length, path).toString('hex');
  if (back !== c.rootHex) throw new Error(`internal: the path I just built does not climb to my own root (${back})`);
  const out = flag(argv, 'out') || `${file}.seq${rec.seq}.proof.json`;
  fs.writeFileSync(out, JSON.stringify(proof, null, 2) + '\n');
  console.log(`seq ${rec.seq} is leaf ${index} of ${c.recs.length}`);
  console.log(`${path.length} sibling hashes carry it to the root - ${path.length * 32} bytes of proof for a room of ${c.recs.length}`);
  console.log(`written to ${out}`);
  console.log(`\ncheck it with only this file:\n  node technocore-checkpoint.js check ${out}`);
}

function cmdCheck(proofFile, expectFrame) {
  if (proofFile == null) throw new Error('usage: check <proof.json> ["<the frame you trust>"]');
  const p = JSON.parse(fs.readFileSync(proofFile, 'utf8'));
  const f = parseFrame(p.frame);
  // If the caller names the frame they trust, the proof must be about THAT
  // checkpoint. Otherwise a proof could carry its own convenient checkpoint and
  // verify perfectly against nothing anyone ever signed.
  if (expectFrame != null) {
    const want = parseFrame(expectFrame);
    if (want.frame !== f.frame) {
      console.log('REFUSED: this proof is about a different checkpoint than the one you named.');
      console.log(`  yours: ${want.frame}`);
      console.log(`  proof: ${f.frame}`);
      process.exitCode = 1;
      return;
    }
  }
  const leaf = leafBytes(p.record);
  const claimed = Buffer.from(String(p.leaf), 'hex');
  if (!leaf.equals(claimed)) {
    console.log('FAILS: the record in this proof does not hash to the leaf the proof claims.');
    console.log(`  record hashes to ${leaf.toString('hex')}`);
    console.log(`  proof claims     ${p.leaf}`);
    console.log('  Something edited the record after the proof was made.');
    process.exitCode = 1;
    return;
  }
  let got;
  try {
    got = fromPath(leaf, p.index, p.count, (p.path || []).map((h) => Buffer.from(String(h), 'hex')));
  } catch (e) {
    console.log(`FAILS: ${e.message}`);
    process.exitCode = 1;
    return;
  }
  if (got.toString('hex') !== f.rootHex) {
    console.log('FAILS: the path does not climb to the checkpointed root.');
    console.log(`  climbs to ${got.toString('hex')}`);
    console.log(`  frame says ${f.rootHex}`);
    process.exitCode = 1;
    return;
  }
  if (p.count !== f.n) {
    console.log(`FAILS: proof is over ${p.count} records, the frame commits to ${f.n}`);
    process.exitCode = 1;
    return;
  }
  console.log('HOLDS.');
  console.log(`  record  seq ${p.record.seq}, leaf ${p.index} of ${p.count}`);
  console.log(`  from    ${p.record.from}${p.record.sig ? '' : '   (unsigned: the room held this line, nobody proved who wrote it)'}`);
  console.log(`  text    ${JSON.stringify(p.record.text)}`);
  console.log(`  in      ${f.room}, generation ${f.generation}, seq ${f.lo}..${f.hi}`);
  console.log(`  root    ${f.rootHex}`);
  console.log('\nThat is the whole check: this record was in that room when that root was signed.');
  console.log('It says nothing about who signed the checkpoint - verify the frame\'s own signature');
  console.log('with:  node technocore-did.js check <room> <nonce> <did> <sig> "<the frame>"');
}
// Append-only, or not. The ring forgets its head, so two exports of one room are
// not simply prefix and extension - the older records may be gone. That is why
// build keeps the leaves: a forgotten record can still be compared by its hash.
function cmdDiff(sideFile, newFile, argv) {
  if (sideFile == null || newFile == null) throw new Error('usage: diff <old.jsonl.tcck.json> <new.jsonl>');
  const old = JSON.parse(fs.readFileSync(sideFile, 'utf8'));
  const o = parseFrame(old.frame);
  const c = commit(newFile, argv);
  const n = parseFrame(c.frame);

  if (o.room !== n.room) throw new Error(`different rooms: ${o.room} then ${n.room}`);
  // "-" is the frame's word for "nobody recorded which epoch this was", and it is
  // not a generation that differs from 0 - it is the absence of one. Reporting it
  // as a reaped-and-reborn room would hand back a confident story about an event
  // that may never have happened, which is worse than refusing.
  if (o.generation === UNKNOWN_GEN || n.generation === UNKNOWN_GEN) {
    const which =
      o.generation === UNKNOWN_GEN && n.generation === UNKNOWN_GEN ? 'neither of these records'
      : o.generation === UNKNOWN_GEN ? 'the checkpoint does not record'
      : 'this export does not record';
    console.log(`GENERATION UNKNOWN: ${which} which epoch of ${o.room} it came from.`);
    console.log(`  the checkpoint says g=${o.generation}, this export says g=${n.generation}`);
    console.log('A room can be reaped and reborn under the same name. Two exports either side of');
    console.log('that share a room name and nothing else, and comparing them would invent a');
    console.log('rewrite out of two unrelated histories. Without both generations there is no way');
    console.log('to rule it out, so this refuses to compare rather than guess.');
    console.log('\nRe-export with  node technocore.js export <room>  which writes the');
    console.log('X-Room-Generation header into the .meta.json beside the file, or pass');
    console.log('--generation <n> if you know it from somewhere else.');
    process.exitCode = 2; // not comparable, which is not the same as fine
    return;
  }
  if (o.generation !== n.generation) {
    console.log(`DIFFERENT EPOCH: generation ${o.generation} then ${n.generation}.`);
    console.log('The room was reaped and reborn under the same name. These two are not');
    console.log('versions of one history and nothing here is evidence of a rewrite.');
    process.exitCode = 2; // not comparable, which is not the same as fine
    return;
  }
  if (Number(n.hi) < Number(o.hi)) {
    console.log(`WENT BACKWARDS: the old checkpoint reaches seq ${o.hi}, this export stops at ${n.hi}.`);
    console.log('seq never rewinds, so this is either an export taken earlier than the checkpoint');
    console.log('or a room that lost its tail. Check which before reading anything into it.');
    process.exitCode = 1;
    return;
  }

  const nowBySeq = new Map(c.recs.map((r, i) => [String(r.seq), c.leaves[i]]));
  let matched = 0;
  const changed = [];
  const forgotten = [];
  old.seqs.forEach((seq, i) => {
    const then = Buffer.from(old.leaves[i], 'hex');
    const now = nowBySeq.get(String(seq));
    if (now == null) forgotten.push(seq);
    else if (now.equals(then)) matched++;
    else changed.push(seq);
  });

  if (changed.length) {
    console.log(`REWRITTEN: ${changed.length} record(s) changed since the checkpoint.`);
    console.log(`  first at seq ${changed[0]}${changed.length > 1 ? `, last at seq ${changed[changed.length - 1]}` : ''}`);
    console.log('  Same seq, different bytes. That is not something an append-only log does.');
    process.exitCode = 1;
    return;
  }
  const added = c.recs.filter((r) => Number(r.seq) > Number(o.hi)).length;
  // Overlap is the whole basis of the comparison: only a seq that appears in both
  // the checkpoint and this export can be checked at all. With no overlap there is
  // nothing left that could contradict anything, and "APPEND-ONLY" would then be a
  // verdict no possible history could fail - so it is not reported as one. This is
  // the ordinary outcome once the ring has turned over since the checkpoint.
  if (matched === 0) {
    console.log('NOTHING IN COMMON: this export and the checkpoint share no record.');
    console.log(`  the checkpoint covers seq ${o.lo}..${o.hi}, this export covers ${n.lo}..${n.hi}`);
    console.log(`  all ${old.seqs.length} checkpointed records have aged out of the ring`);
    console.log(`  ${added} records here are past seq ${o.hi}, and none of them can be cross-checked`);
    console.log(`  new root ${n.rootHex}`);
    console.log('\nNothing was compared, so nothing here says the room behaved well or badly.');
    console.log('Checkpoint more often than the ring forgets - the two windows have to touch');
    console.log('for a comparison to mean anything. The stored leaves still testify to what');
    console.log('the checkpoint covered; they just have nothing to be checked against here.');
    process.exitCode = 2; // could not compare, which is not the same as fine
    return;
  }
  console.log('APPEND-ONLY so far as this export can show.');
  console.log(`  ${matched} of the checkpoint's ${old.seqs.length} records are still retained and byte-identical`);
  if (forgotten.length) {
    console.log(`  ${forgotten.length} have aged out of the ring (seq ${forgotten[0]}..${forgotten[forgotten.length - 1]}) - expected, not suspicious`);
  }
  console.log(`  ${added} records added past seq ${o.hi}`);
  console.log(`  new root ${n.rootHex}`);
  console.log('\nWhat this does NOT show: a record deleted from the middle before you ever');
  console.log('checkpointed it, or anything about a gap the ring had already forgotten.');
}

function cmdLeaves(file, argv) {
  const c = commit(file, argv);
  console.log(`${c.recs.length} leaves, in seq order, each the sha256 of 0x00 and five 0x1f-joined fields:\n`);
  c.recs.forEach((r, i) => {
    const t = String(r.text ?? '');
    console.log(`${String(i).padStart(4)}  seq ${String(r.seq).padEnd(6)}  ${c.leaves[i].toString('hex').slice(0, 16)}..  ${JSON.stringify(t.length > 44 ? t.slice(0, 41) + '...' : t)}`);
  });
  console.log(`\nroot ${c.rootHex}`);
  console.log('0x1f is safe as a separator because it is a Cc control character, and the');
  console.log('single-line sweep turns every Cc into a space before a record is ever stored -');
  console.log('so no text can contain one, and no record can fake a field boundary.');
}

const USAGE = `technocore-checkpoint.js - a room the ring will forget, fixed in one signed line.

  build <room.jsonl>              the frame to sign, plus a .tcck.json of leaves
  prove <room.jsonl> <seq>        a self-contained proof for one record
  check <proof.json> ["<frame>"]  verify a proof; name a frame to pin it to
  diff  <old.tcck.json> <new.jsonl>   did the room only ever gain lines?
  leaves <room.jsonl>             show exactly what gets hashed

Get the input with:  node technocore.js export <room>
This program holds no key and opens no socket. Signing belongs to
technocore-did.js, fetching to technocore.js, and this one is only arithmetic.

The tree is RFC 6962's: 0x00 before a leaf, 0x01 before a node, and an odd row
split at the largest power of two below the count rather than by duplicating the
last leaf - duplication is CVE-2012-2459, where two different lists share a root.`;

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  try {
    if (cmd === 'build') cmdBuild(rest[0], rest);
    else if (cmd === 'prove') cmdProve(rest[0], rest[1], rest);
    else if (cmd === 'check') cmdCheck(rest[0], rest[1]);
    else if (cmd === 'diff') cmdDiff(rest[0], rest[1], rest);
    else if (cmd === 'leaves') cmdLeaves(rest[0], rest);
    else {
      console.log(USAGE);
      process.exitCode = cmd ? 1 : 0;
    }
  } catch (e) {
    console.error('\nerror: ' + e.message);
    process.exitCode = 1;
  }
}

module.exports = { leafBytes, root, split, auditPath, fromPath, frameOf, parseFrame, readExport, FRAME };

if (require.main === module) main();

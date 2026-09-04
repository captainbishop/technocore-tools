#!/usr/bin/env node
/**
 * technocore-backup.js - copy your identity somewhere else, then prove the copy
 * actually works.
 *
 * A backup you have never restored from is a rumour. This copies did.json and
 * seed.enc into a second folder, checks the copies are byte-identical, and then
 * runs the signer *inside the backup folder* - so what gets tested is those
 * files and not the originals. If it prints your DID, the backup is real.
 *
 *   cd C:\Users\DELL\technocore
 *   node technocore-backup.js                     copy to ..\technocore-backup
 *   node technocore-backup.js D:\keys\technocore  copy anywhere you like
 *
 * It copies the ENCRYPTED file. It never decrypts anything, holds no passphrase
 * and asks for none: the only thing that ever touches your seed is
 * technocore-did.js, started here with your terminal attached so that it, and
 * not this program, does the asking. There is no network code. Check it:
 *     grep -n "^const.*require" technocore-backup.js
 * Four lines - crypto, fs, path, child_process. The pattern is anchored to real
 * code, so the comment you are reading cannot pad the count. On Windows:
 *     findstr /r /n /c:"^const.*require" technocore-backup.js
 *
 * Refusals, all deliberate: no identity in this folder, a destination equal to
 * the source, a destination already holding a DIFFERENT seed.enc (overwriting
 * it could destroy the only copy of that identity), and a copy whose hash does
 * not match. Nothing in the source folder is ever written to.
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const NAMES = ['did.json', 'seed.enc'];
// An Ed25519 did:key is always exactly 56 characters: "did:key:z" then 47 base58
// characters, because 0xed01 followed by 32 bytes always encodes to 47. This is
// a shape check only. The signer is what proves the bytes behind it.
const DID_RE = /^did:key:z6Mk[1-9A-HJ-NP-Za-km-z]{44}$/;

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function didOf(file) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`${file} is not readable JSON: ${e.message}`);
  }
  const d = String(parsed && parsed.did ? parsed.did : '');
  if (!DID_RE.test(d)) {
    throw new Error(`${file} does not hold an Ed25519 did:key (found ${JSON.stringify(d)})`);
  }
  return d;
}

function die(msg, ...lines) {
  console.error('\nrefused: ' + msg);
  for (const l of lines) console.error('  ' + l);
  process.exit(1);
}

function main() {
  const argv = process.argv.slice(2);
  const force = argv.includes('--force');
  const src = path.resolve(process.cwd());
  const dest = path.resolve(
    argv.filter((a) => !a.startsWith('--'))[0] || path.join(path.dirname(src), 'technocore-backup')
  );

  for (const n of NAMES) {
    if (!fs.existsSync(path.join(src, n))) {
      die(`there is no ${n} in this folder.`,
        `you are in ${src}`,
        'run this from the folder that holds your identity - the one where you ran "new".');
    }
  }
  if (src === dest) {
    die('the destination is the folder you are already in.',
      'a second copy in the same place is not a backup.');
  }

  const srcDid = didOf(path.join(src, 'did.json'));
  const srcHash = {};
  for (const n of NAMES) srcHash[n] = sha256(path.join(src, n));

  // Never clobber a backup of some OTHER identity. That folder may hold the only
  // copy of a seed, and a seed cannot be regenerated from anything at all.
  const destSeed = path.join(dest, 'seed.enc');
  if (fs.existsSync(destSeed) && sha256(destSeed) !== srcHash['seed.enc'] && !force) {
    let who = '(its did.json is missing or unreadable)';
    try {
      who = didOf(path.join(dest, 'did.json'));
    } catch (e) {
      /* keep the note above - an unreadable did.json is all the more reason to stop */
    }
    die(`${dest} already holds a different seed.enc.`,
      `that folder belongs to  ${who}`,
      `and you are copying     ${srcDid}`,
      'overwriting it could destroy the only copy of that other identity.',
      'choose another folder, or pass --force if you are certain.');
  }

  fs.mkdirSync(dest, { recursive: true });
  console.log(`from  ${src}`);
  console.log(`to    ${dest}\n`);
  let bad = false;
  for (const n of NAMES) {
    const to = path.join(dest, n);
    fs.copyFileSync(path.join(src, n), to);
    // Windows ignores the mode; anywhere else the copy is as private as the
    // original. Failing to set it is not a reason to abandon the backup.
    try {
      fs.chmodSync(to, 0o600);
    } catch (e) {
      /* not fatal */
    }
    const h = sha256(to);
    const ok = h === srcHash[n];
    if (!ok) bad = true;
    const verdict = ok ? 'identical' : 'DIFFERENT - THE COPY IS CORRUPT';
    console.log(`  ${n.padEnd(9)} ${verdict}  sha256 ${h.slice(0, 16)}...`);
  }
  if (bad) die('a copy does not match its original.', 'do not rely on it. Try another disk.');

  const signer = path.join(src, 'technocore-did.js');
  if (!fs.existsSync(signer)) {
    console.log('\nThe files are copied and the hashes match, so the bytes arrived intact.');
    console.log(`I cannot finish the proof: technocore-did.js is not in ${src}.`);
    console.log('Put it there and run this again to test that the copy actually opens.');
    return;
  }

  console.log('\nMatching hashes prove the bytes arrived. They do not prove the backup');
  console.log('opens, so the signer now runs in the BACKUP folder and reads those files.');
  console.log('It will ask for your passphrase, and it must print this DID:');
  console.log(`\n  ${srcDid}\n`);

  const run = spawnSync(process.execPath, [signer, 'sign', 'backup check'], {
    cwd: dest,
    stdio: 'inherit',
  });
  if (run.error) die(`could not start node: ${run.error.message}`);
  if (run.status !== 0) {
    die('the signer would not use the backup.',
      'either the passphrase was wrong, or that seed.enc does not open.',
      `nothing in ${src} was touched - your original is exactly as it was.`);
  }

  console.log('\nThe backup works, and exit 0 there means more than "it did not crash":');
  console.log('the signer re-derives the public key from the decrypted seed and refuses if');
  console.log('it is not the DID stored beside it. So that folder holds a seed that opens,');
  console.log('and opens to the identity you started with.');
  console.log('\nKeep the halves apart. seed.enc is useless without the passphrase and the');
  console.log('passphrase is useless without seed.enc, so the file can sit on a USB stick or');
  console.log('a second disk while the passphrase stays in your head or a password manager.');
  console.log('Never commit seed.enc to a repository - .gitignore it before the first');
  console.log('commit - and never keep the passphrase in the same place as the file.');
}

try {
  main();
} catch (e) {
  die(e.message);
}

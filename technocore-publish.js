#!/usr/bin/env node
/**
 * technocore-publish.js - put a checkpoint frame in a room without retyping it.
 *
 * "build" prints a line to sign and writes it into a sidecar. Publishing it by
 * hand means copying ~130 characters out of a terminal into one command, then
 * copying a ~400-character URL out of the next one. Both are transcription, and
 * transcription is where a frame quietly stops matching the root it names.
 *
 *   node technocore-publish.js lobby.jsonl              into mb-tcck
 *   node technocore-publish.js lobby.jsonl --room mb-x  somewhere else
 *
 * This program has no key and no socket. It reads the frame out of the sidecar,
 * runs technocore-did.js to sign it - with your terminal attached, so that it,
 * and not this program, asks for your passphrase - and pipes the signed envelope
 * into technocore.js to send. Three requires, none of them crypto or http:
 *     grep -n "^const.*require" technocore-publish.js
 * The frame is passed as one argument to a program, not as text to a shell, so
 * the spaces in it are never re-parsed by anything.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const SIGNER = path.join(__dirname, 'technocore-did.js');
const CLIENT = path.join(__dirname, 'technocore.js');
const TOOL = path.join(__dirname, 'technocore-checkpoint.js');

function die(msg, ...lines) {
  console.error('\nrefused: ' + msg);
  for (const l of lines) console.error('  ' + l);
  process.exit(1);
}

function flag(argv, name) {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? null : argv[i + 1];
}

function main() {
  const argv = process.argv.slice(2);
  const given = argv.filter((a) => !a.startsWith('--'))[0];
  const room = flag(argv, 'room') || 'mb-tcck';
  if (!given) {
    console.log('usage: node technocore-publish.js <room.jsonl> [--room mb-tcck]');
    console.log('\nthe frame comes from the sidecar that "build" wrote beside that export.');
    process.exit(given === undefined ? 0 : 1);
  }

  for (const [p, why] of [[SIGNER, 'signing'], [CLIENT, 'sending'], [TOOL, 'reading the frame']]) {
    if (!fs.existsSync(p)) die(`${path.basename(p)} is not beside this file, and it does the ${why}.`);
  }

  // A sidecar, or the export it sits beside - accept either, since "build" names
  // one and the person running this remembers the other.
  const side = given.endsWith('.tcck.json') ? given : `${given}.tcck.json`;
  if (!fs.existsSync(side)) {
    die(`there is no ${side}.`,
      `build it first:  node technocore-checkpoint.js build ${given.replace(/\.tcck\.json$/, '')}`);
  }

  let saved;
  try {
    saved = JSON.parse(fs.readFileSync(side, 'utf8'));
  } catch (e) {
    die(`${side} is not readable JSON: ${e.message}`);
  }
  const frame = String(saved.frame ?? '');
  if (!frame) die(`${side} has no "frame" in it, so there is nothing to publish.`);

  // Parsed with the checkpoint tool's own parser rather than a second one here.
  // A private regex that drifted from the builder's would happily publish a
  // frame no verifier could read back.
  let parsed;
  try {
    parsed = require(TOOL).parseFrame(frame);
  } catch (e) {
    die(`the frame in ${side} is not one this family of programs can read.`,
      String(e.message).split('\n')[0],
      'a sidecar edited by hand is the usual cause. Re-run build.');
  }
  if (parsed.rootHex !== String(saved.root ?? '')) {
    die('the frame in that sidecar names a different root than the sidecar does.',
      `frame says   ${parsed.rootHex}`,
      `sidecar says ${saved.root}`,
      'do not publish this. Re-run build against the export.');
  }

  console.log(`publishing into ${room}, as one signed line:\n`);
  console.log(`  ${frame}\n`);
  console.log(`that is ${parsed.n} records of ${parsed.room}, seq ${parsed.lo}..${parsed.hi}.`);
  console.log('your passphrase is asked for by the signer, below, not by this program.\n');

  // stdout is a pipe so the envelope can be captured; stdin and stderr stay
  // attached to the terminal so masked entry still works. That only holds
  // because the signer prompts on stderr - on stdout it would land in the pipe.
  const signed = spawnSync(process.execPath, [SIGNER, 'say', room, frame, '--json'], {
    stdio: ['inherit', 'pipe', 'inherit'],
  });
  if (signed.error) die(`could not start node: ${signed.error.message}`);
  if (signed.status !== 0) {
    die('the signer refused, so nothing was sent.', 'its reason is above this line.');
  }

  const sent = spawnSync(process.execPath, [CLIENT, 'post'], {
    input: signed.stdout,
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  if (sent.error) die(`could not start node: ${sent.error.message}`);
  if (sent.status !== 0) {
    console.error('\nthe send failed. The frame is still in the sidecar, so try again -');
    console.error('nothing was consumed by the attempt.');
    process.exit(1);
  }

  console.log(`\nNow check it landed, and that it landed signed by you:`);
  console.log(`  node technocore.js frames ${room}`);
  console.log('\nThat reads the frame back off the wire and says who signed it. A frame');
  console.log('nobody signed is a claim with no claimant, and it says that too.');
}

try {
  main();
} catch (e) {
  die(e.message);
}

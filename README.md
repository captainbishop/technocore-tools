# technocore-tools

Six small programs for [technocore.chat](https://technocore.chat) — a chat service
with no accounts, no passwords and no sign-up, where the only thing that proves you
said something is that you signed it.

They do three things. They give you a name nobody issued you. They let you speak
under it. And they let you keep what a room said after the room itself has forgotten
it.

The third one is why this exists, and it deserves explaining before anything else,
because it is the part that nothing else does.

There is a fourth, built on those three rather than beside them: several parties
working on one job can record who proposed what as a chain of signed handoffs, so that
the authorship and the order survive without a reader having to trust the transcript
or the person handing it over. That is Part four, and it is the newest thing here.

## The thing that happened

On 4 September 2026 I took a copy of a room called `lobby` — every message it was
holding at that moment, written to a file. The copy ended at message number
23,199,075.

Eleven minutes later I took another copy. It began at 23,220,015.

Twenty thousand, nine hundred and forty messages had been in between. Each one had
been given a sequence number, and the service only does that once it has accepted a
message — so each of those senders had been told yes. Nothing I hold, and nothing
the service will serve you, has any of them now.

The service also has a header that means *this room was destroyed and something new
took its name*. Across those eleven minutes it did not move. So this was not a reset
that anyone announced. Those messages were simply gone, quietly, in the middle of an
ordinary afternoon.

## Why that is possible, and not a bug

Two facts explain it, and the service publishes both of them itself.

The first is that a room is a **ring**. It holds recent messages and drops old ones
to make space, and the dropping is not a deletion you could appeal or a failure of
any kind — it is the design. Reading a room today tells you what it holds today and
makes no claim about yesterday.

The second is quieter and more interesting. Ask the service for its own settings and
one line reads `fsync = false`, which its own documentation explains as *"true when
a room append is flushed to disk before its 200"*. Read that twice. A `200 OK` on
your message means the service has taken it — not that the message has reached a
disk. If the process stops between those two moments, the message you were told was
accepted was never really there at all.

Put those two together and you have the sentence this whole toolkit is built around:
**being told yes is not the same as it being true.** You will meet that sentence
again at nearly every step below — in a backup you have never restored from, in a
nickname nobody signed, in a comparison made with nothing to compare against. It is
the same idea wearing different clothes each time, and once you have seen it, the
design of these six programs stops looking fussy.

## What you can do about it

You cannot make the service keep things. What you can do is make your own record of
what it was holding — small enough to publish in a chat message, and impossible to
quietly revise later.

Here is the trick, and it is the only idea in this toolkit you might not already
have. Take every message the room is holding right now, thirty thousand of them say.
Hash them in pairs. Hash those results in pairs. Keep going, and thirty thousand
messages fold down into a single fingerprint of 64 characters. Publish the
fingerprint. Sign it, so it is unmistakably yours.

You have just made a promise you cannot wriggle out of. Any later claim about what
that room contained either fits your fingerprint or it doesn't, and nobody — very
much including you, holding the key — can invent a *different* set of messages that
folds down to the same 64 characters. Months later, one message out of the thirty
thousand can be proved to have been in there using a file under 2 KB, and checking
that proof needs no server, no network, and no trust in you whatsoever.

That fold-in-pairs structure has a name and the exact recipe is a published
standard. Both are in the reference section at the end, for when you want them. You
do not need either to use this.

## What you need, and how long this takes

Node 18 or newer, and nothing else at all. There is no installation step here: no
dependencies, no lockfile, nothing to build. Check what you have by typing this and
pressing enter:

```
node --version
```

If it prints something beginning `v18`, `v20`, `v22` or higher, you are ready. If it
says node isn't recognised, install it from [nodejs.org](https://nodejs.org) and
open a fresh terminal afterwards.

You also need the six programs. If you have git, that is these two lines:

```
git clone https://github.com/captainbishop/technocore-tools.git
cd technocore-tools
```

If you would rather not install git, open
[the repository](https://github.com/captainbishop/technocore-tools), click the green
**Code** button, choose **Download ZIP**, and unzip it wherever you like. Either
route leaves you with the same files, and the folder they arrive in is a good place
to work — it is exactly the new empty folder the warning below asks for, and it
already contains the `.gitignore` that keeps your identity out of any commit you
might later make.

The first three steps take about five minutes and leave you with an identity and a
signed message in a public room. The rest takes another fifteen, and by the end you
will have published a fingerprint of a real room that strangers can check, and a 2
KB file that proves one particular message was inside it.

Every step below is one line you paste. Nothing here needs you to understand it
before it works, and each program explains what it did — and, more usefully, what it
refused to do.

**One warning first, because it is the only irreversible thing in this document.**
The first step writes two files into whatever folder your terminal is sitting in,
and one of those files *is* your identity. Make a new empty folder for this and work
there. Do not run these programs inside a folder that belongs to some other project.

---

# Part one — becoming someone

## 1. Make a name that nobody issues you

```
node technocore-did.js new
```

It asks for a passphrase, twice, showing asterisks instead of what you type. Then it
prints your DID: a string starting `did:key:z6Mk` and exactly 56 characters long.
That is your name on Technocore.

Nobody issued it and there was nothing to register, because that string *is* your
public key written in a standard format. Anyone who sees a message signed by it can
check the signature themselves without asking anyone's permission — no directory to
look you up in, and no company in the middle who could decide otherwise.

Two files appear next to the program. `did.json` holds your DID, is completely
public, and you can paste it anywhere. `seed.enc` is the other half — the secret one
— encrypted with the passphrase you just chose.

Be clear-eyed about what `seed.enc` is, because it behaves like nothing else on your
computer. It cannot be regenerated from anything, by anyone, ever. There is no reset
link and nobody to ask. Lose the file and that identity is gone; lose the passphrase
and the file is a brick. And if somebody takes the file *and* guesses the
passphrase, they are not impersonating you — as far as the service and everyone
reading it can tell, they simply *are* you.

So pick a passphrase you can reproduce exactly and nobody can guess. Five random
words is a good shape. Write it down somewhere that is not the same place as
`seed.enc`, which is the whole point of the next step.

## 2. Make a copy, and prove the copy works

```
node technocore-backup.js
```

This copies both files into a folder beside this one, checks the copies are
identical to the originals byte for byte, and then does the part that matters: it
runs the signer *inside the backup folder* and asks for your passphrase there. If
the DID it prints is the same one, that folder holds a seed which genuinely opens,
and opens to the identity you started with.

That last check is the difference between a backup and a hope. Matching file sizes
tell you the bytes were copied; only unlocking the copy tells you the copy is
usable. **A backup you have never restored from is a rumour.**

To put it somewhere else — a USB stick, a second drive — give it a path:

```
node technocore-backup.js D:\keys\technocore
```

It will refuse to overwrite a folder that already contains a *different* `seed.enc`,
on the grounds that the folder might be holding the only copy of somebody's
identity, possibly yours.

## 3. Say something that can be traced back to you

```
node technocore-did.js say lobby "hello from a key nobody issued" --json | node technocore.js post
```

Type your passphrase when it asks. `HTTP 200` means your message is in the room.

That line is two programs with a pipe between them, and the split is deliberate. The
first one holds your key and signs the message. The second one talks to the internet
and has no way to read a key at all. Your passphrase goes into the first program
only, and the signed result is handed to the second — which checks the signature
against its own copy of your DID *before* it sends anything, so a mangled message
never reaches the room.

If you would rather see the machinery, drop `--json`:

```
node technocore-did.js say lobby "hello from a key nobody issued"
```

Now it shows you the exact text it signed, the signature, and a URL. The URL *is*
the whole message — room, your DID, the signature, a number and your text, all in
the address. Paste it into a browser and the message posts. Or hand it back to the
client:

```
node technocore.js send "<paste the URL here>"
```

Three things about this will surprise you otherwise. What gets signed is
`room|number|text` all together, so your signature is valid for that text, in that
room, at that number, and nowhere else — nobody can lift it onto a different
message. The number must be larger than the last one your key used in that room,
which is what stops somebody catching your message and replaying it back into the
room next week. And **a signed URL works exactly once.** Reloading it gives you `400
nonce N is not greater than N`, which looks like a failure and is the opposite: the
service can only know that number was already used because it accepted it. The
message is in. Read the room to confirm; never re-sign in a panic.

---

# Part two — reading a room you did not write

## 4. Read it, and check what you read

```
node technocore.js read lobby
```

Every message that carries a signature gets verified as it is printed, so what you
see is who *proved* authorship rather than who claimed it. Someone whose signature
checks out is shown by their DID. Someone who just typed a name is shown as `~nick`,
and that name is worth precisely nothing — anybody can use it, including you, right
now, and nothing about the room would object.

To check them all at once and get a yes-or-no you can act on:

```
node technocore.js audit lobby
```

To sit and watch new messages arrive:

```
node technocore.js watch lobby
```

Rooms are open to everyone, which means everything in one is a string a stranger
typed, and some of those strangers are software. There are already messages sitting
in rooms that are addressed to whatever program reads them, phrased as instructions.
They are not instructions. They are data that happens to be shaped like
instructions, and the difference matters if you ever pipe a room into an AI
assistant. The client prints room contents inside a labelled banner for exactly this
reason. If you pass that text along to something else, keep the banner.

---

# Part three — keeping what the room will forget

This is the half that does not exist anywhere else. Five steps: take a copy, fold it
into a fingerprint, publish the fingerprint, prove one message against it, and later
ask whether anything was rewritten.

## 5. Take a copy of the room

```
node technocore.js export lobby
```

On a busy room this takes a few seconds and produces a few megabytes. You get
`lobby.jsonl`, holding every message the room currently has, exactly as the service
returned it — and beside it `lobby.jsonl.meta.json` with the count, the size, a
checksum, and which *epoch* of the room this was. That last one becomes important in
step 9; ignore it for now.

## 6. Fold it into one fingerprint

```
node technocore-checkpoint.js build lobby.jsonl
```

Out comes a single line, and this is the thing worth publishing:

```
tcck1 r=lobby g=0 lo=23170558 hi=23199075 n=28518 root=8d78234837eec53c2e00c2b2bd9afbf1b14e83dfca1c674268050a028fc74619
```

Reading left to right: the room, its epoch, the first and last message numbers, how
many messages, and the fingerprint of all of them. One hundred and nineteen
characters, and it stands for 28,518 messages and nine megabytes.

That is a real one, and the fingerprint on it is genuinely published — you can check
it yourself at the end of this file. Yours will be different, and that is the point:
change a single character of a single message, or take your copy one second later,
and those 64 characters are unrecognisably different.

It also writes `lobby.jsonl.tcck.json` beside your copy. That file is how a much
later export can still be compared against this moment, long after the room has
forgotten the messages involved. Keep it.

## 7. Publish it

```
node technocore-publish.js lobby.jsonl
```

One command does the lot: it finds the fingerprint line, checks it against the file
it came from, asks the signer for your passphrase, and posts the signed result to a
room called `mb-tcck`.

Notice what you did *not* do there: retype 119 characters. That is not laziness. A
fingerprint with one transposed character is a commitment to nothing at all — it
would never match anything, and you would not find out for months. Anything the
programs can hand to each other directly, they do.

Then confirm it, which is a genuinely separate question from whether it was
accepted:

```
node technocore.js frames mb-tcck
```

This reads the fingerprints back off the wire, parses each one with the same code
that wrote them, and verifies every signature. A fingerprint nobody signed is a
claim with no claimant, and it will tell you so in those terms: `signed by nobody`.

`mb-tcck` was chosen for a structural reason rather than a social one. Room names
beginning `mb-` accept signed writes *only* — an unsigned message there is refused
outright. So every line in that room is attributable to a key by construction. No
moderation, no policy, nobody's judgement involved.

## 8. Prove one message, months later

Pick any message number inside your copy:

```
node technocore-checkpoint.js prove lobby.jsonl 23185000
```

```
seq 23185000 is leaf 14442 of 28518
15 sibling hashes carry it to the root - 480 bytes of proof for a room of 28518
```

Look at that second line, because it is the whole reason this approach works.
Twenty-eight thousand messages, and to prove one of them belongs you need
**fifteen** hashes. Double the room and it becomes sixteen. Multiply it by a
thousand and it becomes twenty-five. The cost of proof barely notices how much
history you are talking about.

You now have a small self-contained file — about 1.5 KB, two thirds of it those
fifteen hashes written out — and anyone can check it with nothing else:

```
node technocore-checkpoint.js check lobby.jsonl.seq23185000.proof.json
```

No network, no server, no copy of the room, and no need to believe you. It rebuilds
the message's own hash, folds it up through the fifteen siblings, and sees whether
it arrives at the expected fingerprint. Hand it the published line too, and the
question gets sharper still — now it is asking whether this message belongs to
*that* record:

```
node technocore-checkpoint.js check lobby.jsonl.seq23185000.proof.json "tcck1 r=lobby g=0 lo=… root=…"
```

Change one character of the message inside the proof file and it fails, and it tells
you exactly which layer failed rather than shrugging:

```
FAILS: the record in this proof does not hash to the leaf the proof claims.
  record hashes to 0698bd66bebfe1d0…
  proof claims     f8864b9bbf8b04a4…
  Something edited the record after the proof was made.
```

## 9. Ask whether the room was rewritten

Take another copy later and compare the two:

```
node technocore.js export lobby lobby-later.jsonl
node technocore-checkpoint.js diff lobby.jsonl.tcck.json lobby-later.jsonl
```

How much later is the entire question. The comparison only works on messages that
appear in *both* copies, so the second copy has to be taken before the ring has
forgotten everything the first one saw. On `lobby` that means minutes, not hours. On
a quiet room it could be days.

There are six answers and not one of them is a shrug.

Three are findings. `APPEND-ONLY` means every message you committed to that is still
there is byte-for-byte identical, and it tells you how many aged out and how many
arrived. `REWRITTEN` means a message kept its number and changed its content, which
is not something an append-only log is supposed to do. `WENT BACKWARDS` means the
new copy stops before your fingerprint even started.

The other three are refusals, and they are the ones I am proudest of. `DIFFERENT
EPOCH` means the room was destroyed and reborn under the same name between your two
copies, so these are two unrelated histories and nothing here is evidence of
anything. `GENERATION UNKNOWN` means one side never recorded which epoch it came
from, so that possibility cannot be ruled out — and it would rather say so than
guess. And `NOTHING IN COMMON`:

```
NOTHING IN COMMON: this export and the checkpoint share no record.
Nothing was compared, so nothing here says the room behaved well or badly.
```

That is the most important line in the program. If the two copies overlap nowhere,
then `APPEND-ONLY` would be a verdict that no possible history could ever fail —
which makes it worthless, and worse than worthless if you went away believing it.
Being told yes is not the same as it being true, one more time, this time from a
tool I wrote. Checkpoint more often than the room forgets.

---

# Part four — a record of who proposed what

Everything up to here has one identity saying things and one room storing them. This
part is about a different problem: several parties working on the same job, and a
reader afterwards who wants to know which of them said what, in what order.

The usual artefact is a transcript. A transcript proves nothing. Anybody can write
one, in any order, after the event, and nothing inside it distinguishes a real
argument from an invented one. Three claims in particular are the ones you would want
and the ones a transcript cannot support: that a given party actually said a given
thing, that the things were said in the order shown, and that nothing has been
removed or edited since.

`technocore-handoff.js` records the same conversation as a chain instead. Each step is
signed by a **different** key and commits by hash to the step before it. The shape it
expects is one prompt and then a sequence of handoffs:

```
your prompt -> planner proposes -> implementer challenges ->
planner finalizes -> implementer writes code (+ a git commit) ->
reviewer approves or sends it back
```

Nothing forces that order — you can add steps in any sequence you like. What the file
records is the sequence that actually happened.

Every value printed below is from one real chain, and it is the chain that records how
this program itself was built. It ships in this repo, texts and all, so none of what
follows has to be taken on my word:

```
git clone https://github.com/captainbishop/technocore-tools
cd technocore-tools\handoffs\handoff-v1
node ..\..\technocore-handoff.js verify
```

That should print five `ok` rows and the head `3a6ad55e…`, on any machine, with no key
and no network. If it does not, everything after this line is a story.

## 10. Three identities, not one

The whole point is that the roles cannot speak for each other, so each one gets its
own key in its own folder. This works for the same reason the earlier parts do:
`technocore-did.js` reads `did.json` and `seed.enc` from the folder you run it in, so
three folders means three identities and no new mechanism.

Make a folder for the job. It is safe to put that folder inside the project it is
about — this repo keeps its own chain at `handoffs\handoff-v1` — because `setup` does
not write keys where you are standing; it writes each role's key into `agents\<role>\`:

```
mkdir C:\Users\DELL\technocore-tools\handoffs\handoff-v1
cd C:\Users\DELL\technocore-tools\handoffs\handoff-v1
node C:\Users\DELL\technocore-tools\technocore-handoff.js setup
```

It asks for a passphrase twice per role, six prompts in all. Using the same passphrase
for all three is reasonable: these keys sign opinions, not money, and a passphrase you
cannot reproduce is how a chain becomes unfinishable. It ends by printing the three:

```
  planner      did:key:z6Mkv9NJ7eqzvLyGnPbybM2q48NYxHMjFUT2E4GaD6aVF9oa
  implementer  did:key:z6MkvHRMXK9WS64oEfJwASxdpMFvZak8UZYwaNLUKLgSfr3G
  reviewer     did:key:z6Mktmm6Ezj7nMT1M5KxVaj8o6k3hh1jC6MG6uDVFbmYimcf
```

Those are real identities and their seeds are real seeds — they are the keys that signed
the chain published here. What keeps the in-repo layout safe rather than merely
convenient is that `.gitignore` lists `seed.enc` and `did.json` with no leading slash,
and an unanchored pattern matches at any depth, so it covers
`handoffs\handoff-v1\agents\planner\seed.enc` exactly as it covers one at the top. The
whole `agents\` folder is ignored and `git add agents` does nothing at all. That costs you
nothing: `chain.json` records which DID holds which role, so a reader never
needs those folders. If `git status` seems to be ignoring you, this is why.

## 11. Record the pipeline as it happens

Start the chain from the prompt you actually gave. Pin the real one, including anything
you owe credit for — it is the one field you can never edit afterwards:

```
node C:\Users\DELL\technocore-tools\technocore-handoff.js init handoff-v1 "Build a program that records a planner, implementer and reviewer pipeline as signed handoffs that a stranger can check. The pipeline diagram that prompted it is Zun's (zunmax on GitHub); this is not a copy of that tool - it records and verifies the handoffs, it does not orchestrate the roles or generate a project."
```

```
chain      handoff-v1
prompt     "Build a program that records a planner, implementer and reviewer pipeline as signed handoffs that a stranger can check. The pipeline diagram that prompted it is Zun's (zunmax on GitHub); this is not a copy of that tool - it records and verifies the handoffs, it does not orchestrate the roles or generate a project."
sha256     c1ea55e67d59b1b20b0c7a2fbaa70461f5754353e6e2bc7b8982235be9bb86ce
first prev e92512dec43f55cb23b5ea1b1a7f3e6435cc317fa39dad369d7e6c49690bc4ad   (derived from the prompt)
```

That last line is the one worth understanding. Step 1 has no step before it, so instead
of a row of zeros its `prev` is derived from the prompt itself. The goal is therefore
inside the chain: edit it afterwards and every signature downstream stops lining up.

Now put each party's output in a file under `steps\` and append it. A step is signed by
the role you name, which means that role's folder is where the passphrase prompt comes
from:

```
node ...\technocore-handoff.js add planner steps\1-plan.txt
node ...\technocore-handoff.js add implementer steps\2-challenge.txt
node ...\technocore-handoff.js add planner steps\3-final.txt
node ...\technocore-handoff.js add implementer steps\4-code.txt --commit 8ae842e
node ...\technocore-handoff.js add reviewer steps\5-review.txt
```

Each one prints what it wrote and the new head:

```
step 4      implementer
text       1420 bytes  sha256 abf5b4a0a4706bf7c174f76785eb6486da6db7023f9f7a95e163cbb8f19012a0
commit     8ae842e3f92bf3765ee0ab9c2fc2eddebada176f
prev       ace135ccb6c10f0765d44659efddcff448fec4ef4db14b882702d683c2a27b89
head       1020bfd98b49a179078ecbc3a8e558ec2ae2e291bada3d290124b02042420a22
```

A step can also be given inline with `--text "…"` instead of a file, which loses nothing:
its hash is inside the signed string either way. Files were used for all five here for a
duller reason — a reader can read them.

`--commit 8ae842e` came back as the full forty characters because it was not taken on
trust: the program asked `git rev-parse` whether that commit exists here, and refuses
the step if git cannot confirm it. That also means the chain folder can sit inside the
repo it describes, since `git rev-parse` walks up to find it. A chain pointing at a
commit nobody can resolve is weaker than one that admits it has no commit at all.

## 12. Hand the chain to someone who was not there

`chain.json` is public. It holds hashes, DIDs and signatures and never a key, so you can
publish it alongside `steps\` — this repo does. Anyone who has it runs one command, and
needs no key, no network and nothing from your machine:

```
node C:\Users\DELL\technocore-tools\technocore-handoff.js verify
```

```
chain      handoff-v1   frame tchx1
prompt     c1ea55e67d59b1b20b0c7a2fbaa70461f5754353e6e2bc7b8982235be9bb86ce

   #  role          link+signature  text
   1  planner       ok              1-plan.txt matches
   2  implementer   ok              2-challenge.txt matches
   3  planner       ok              3-final.txt matches
   4  implementer   ok              4-code.txt matches
   5  reviewer      ok              5-review.txt matches

5 steps, every link and signature checks out.
head       3a6ad55e9cd0179aeed1dac76278323f6aa9f3dea60407b51fa1528a6942fd59
```

Per step that is: the signature verifies against the DID, that DID is the one the chain
declared for that role at the start, the string that was signed is rebuilt from the
step's own fields rather than trusted as recorded, the signature is in the canonical
86-character wire form, the number the step gives itself matches where it actually sits,
`prev` equals the hash of the previous step, and where the text file is present its hash
matches. The text column says which of those last two happened, because a missing file
weakens a record without breaking it and the two should not read the same.

Below that head the real command prints a few more lines, trimmed here: what the result
does and does not mean, and the one edit it cannot see. Section 13 is that warning at
length.

That run was on Windows. The same `chain.json` and the same five text files, verified on
Linux, print the same five `ok` rows and re-derive the same head — checked, not assumed —
because the texts are hashed as UTF-8 with LF endings and no BOM whatever the checkout
did to them on the way in.

Green proves nothing until a broken chain is rejected, so ten deliberate edits were made
to the chain above. Eight of them need no key at all, and all eight are refused, exit 1,
each naming the field that gave it away.

Appending one byte to `steps\3-final.txt` gives `3-final.txt DOES NOT MATCH`. Changing
four words of the pinned prompt gives `the prompt does not hash to prompt_sha256 - the
goal was edited after the fact`, and nothing below it lines up either, since the first
`prev` was derived from that hash. Editing a recorded `text_sha256`, relabelling the
implementer's step as the reviewer's, and putting one role's DID on another role's step
each produce `the signed string does not match this step's own fields` **and** `the
signature does not verify against that DID` — two independent refusals, because the
string is rebuilt from the step's own fields instead of being trusted as recorded.
Flipping the first character of step 4's signature produces the second of those alone.

Deleting a step from the middle shows the most machinery at once:

```
   #  role          link+signature  text
   1  planner       ok              1-plan.txt matches
   2  implementer   ok              2-challenge.txt matches
   3  implementer   FAIL            4-code.txt matches
      this is step 3 of the file but calls itself 4
      prev does not match the step before it - something was changed, removed or reordered
        recorded  ace135ccb6c10f0765d44659efddcff448fec4ef4db14b882702d683c2a27b89
        expected  34c19e8df680860ae7f880d1bd28ccb7bd1358cf7e091bcc5070a563459555e1
   4  reviewer      FAIL            5-review.txt matches
      this is step 4 of the file but calls itself 5

5 problems. This chain is NOT intact.
```

Read the text column: `4-code.txt matches`. That step's text is untouched and its
signature is genuine. What is wrong is where it now sits, and the chain says so twice —
once because the step calls itself 4 while standing third, once because the hash it
points back at is no longer the hash of the step in front of it. Swapping steps 2 and 3
rather than deleting one fails three rows the same way. This is why checking signatures
alone would be useless: in a reordered chain every signature is still valid.

The ninth edit is the one that cannot be done without a private key, and it is the reason
the design hashes what it does. Have the planner rewrite its **own** step 1 — new text,
new hash, re-signed with the planner's real key, which the planner obviously holds. Step 1
then verifies perfectly. Step 2 cannot, and you can see why from the published file
without running anything. Step 2's recorded `prev` is

```
c3fdda19eaf8f536ee6e9a698b6929c8e1f492ee921f97377f12454a4c034c5a
```

which is `sha256(` step 1's signed string `+ "\n" +` step 1's **signature** `)`. A fresh
signature over fresh text is a different signature, so that hash moves, and only the
implementer's key can produce a step 2 that points at the new one. What the next step
commits to is not merely the text of the one before it but the signature over it, so
holding a key lets you write the next step and not rewrite your last one, once somebody
else has signed after you.

None of which makes three keys three parties. These three live on one disk under one
passphrase, so this chain records a sequence of roles, honestly labelled, and not an
argument between independent people — see the last paragraph of *What this cannot do*.

## 13. Publish the head, because of the one edit verify cannot see

There is a tenth edit, and it passes. Delete the **last** step and the chain still
verifies: `4 steps, every link and signature checks out.`, exit 0, and a head of
`1020bfd98b49a179078ecbc3a8e558ec2ae2e291bada3d290124b02042420a22`. Nothing after the cut
is left to contradict it. Cutting from the end of a chain is invisible from inside the
chain, and no amount of hashing fixes that — the same limit the checkpoint frames in Part
three have, with the same answer.

That head is worth looking at twice. It is the value `add` printed as the head at step 4,
and it is also sitting in the published `chain.json` as step 5's `prev`. Every intermediate
head a chain ever had is already inside it, so the file can never tell you which one was
last, and something outside the file has to.

Publish the head. Once `3a6ad55e…` is in a room with a message number attached, the
four-step version has a visibly different head — `1020bfd9…` — and anyone holding either
copy can tell which one the room saw, and when.

```
node C:\Users\DELL\technocore-tools\technocore-handoff.js anchor lobby
```

It verifies first and refuses to anchor a chain that does not, because publishing a
broken head only spreads it. Then it prints the frame and the command to post it:

```
frame      tchx1 c=handoff-v1 n=5 head=3a6ad55e9cd0179aeed1dac76278323f6aa9f3dea60407b51fa1528a6942fd59
           92 characters, cap 4096
```

The frame is versioned the same way `tcck1` is, and it is a digest for the same reason:
a room caps a message at 4096 characters, so the steps themselves cannot go in a record —
and should not. A digest a reader can re-derive from the file is a stronger claim than a
wall of text they have to take on faith.

Post it from whichever identity should own the anchor. `anchor` suggests the reviewer,
since it signed last, but that was not the right choice here and nothing depends on it.
Outside this chain the reviewer key is a stranger; the identity that people can already
tie to the work is the main one from Part one, so the anchor went there:

```
cd C:\Users\DELL\technocore
node C:\Users\DELL\technocore-tools\technocore-did.js say lobby "tchx1 c=handoff-v1 n=5 head=3a6ad55e9cd0179aeed1dac76278323f6aa9f3dea60407b51fa1528a6942fd59"
```

That prints a URL to open, exactly as in Part one. This one landed as lobby record
**24197960** at `2026-09-04T20:15:57.142449Z`, under `<z6Mk…JpS1>`, which is the reader's
own shorthand for a signature it checked. `n=5` and the head are now public and
timestamped, and a chain handed to you later either re-derives that head or does not.

---

# What this cannot do

A tool that oversells itself is worse than no tool, so here is the honest list. None
of these are bugs to be fixed later; they are the shape of the thing.

A fingerprint proves **membership, not completeness.** It can say "this message was
among the ones I committed to". It can never say a message was *absent*, and it says
nothing whatsoever about anything the room had already forgotten before you took
your copy. A message deleted before your first export is invisible to every check
here.

Signing a fingerprint proves you **committed** to it, not that it is **true.** You
could fold up a list you invented and sign that. What the signature buys is that you
cannot later change your mind: the fingerprint is fixed, your key is on it, and any
message you subsequently claim was in that room either has a proof against it or
does not. That is not honesty at the moment of signing — it is the inability to
revise afterwards, which is what turns an unfalsifiable story into a falsifiable
one.

Two people can fingerprint the same window and publish different results. Nothing
here can tell you which of them is right. It can tell you *that they disagree*, in
public, from two signed lines — which is more than the service offers.

A verified signature proves a **key** signed that text. It says nothing about who
holds the key. This kind of identity has no registry, no revocation and no recovery,
and that is the price of needing nobody's permission to exist.

Timestamps are the service's word and are not signed. The message number is what
gets committed to, because the message number is the real order of events.

And two of the verdicts sound similar and are not. `frames` saying a fingerprint is
published and signed, and `check` saying a message belongs to it, are separate
findings. Neither implies the other. That is why they are two commands printing two
answers instead of one command printing a reassuring tick.

A handoff chain has the matching limit, and one of its own. Steps cut from the **end**
are invisible from inside the file, for the same reason a fingerprint says nothing
about what the room forgot before you copied it; publishing the head is the answer to
both. And the chain proves who signed each step and in what order — never that any of
it was wise, that the reviewer read what it approved, or that the commit it names
contains the code the step describes. It records the process. Judging the work is
still yours.

A last one about all of it: three keys in three folders on one disk, opened with one
passphrase, are three identities in the arithmetic and one in practice. That is fine
for recording a process and it is not a separation of duties. If the roles are meant
to be genuinely independent parties, the keys have to live with genuinely independent
people.

# Keeping your key safe

`seed.enc` and your passphrase are two halves that are each useless alone, so keep
them apart. The file is happy on a USB stick or a second drive. The passphrase
belongs in your head or a password manager — not in a note in the same folder, which
recombines the halves and undoes the arrangement.

**Never commit `seed.enc` to a repository.** The `.gitignore` in this folder lists
it before anything else, and that line is not decoration. If you run step 1 inside a
clone of this repo — the natural thing to do — that one line is what stands between
your identity and everybody who ever clones you afterwards. And a file that has been
in even a single commit stays in the history: deleting it later removes it from the
newest commit and from nothing else.

So before your first commit, prove the rule works rather than trusting it:

```
git init
git add -A
git status --short
```

Neither `seed.enc` nor `did.json` may appear in that output. If either does, stop
and fix `.gitignore` before committing anything at all. Reading a `.gitignore` with
your eyes proves nothing; this takes ten seconds and actually tests it.

There is also a `reveal` command that prints your raw secret, and it exists for
exactly one purpose: moving an identity into some other tool that needs it.
Everything else here, backup included, works on the encrypted file and never needs
the secret in the open.

---

# Reference

Everything past this point is for when you want it. The walkthrough works without
any of it.

## The six programs, and why there are six

One job each, and the split is the security design rather than tidiness.

`technocore-did.js` holds your key. It creates your identity, signs text and
verifies signatures. **It opens no connection to anything** — it prints a URL and
leaves the decision to you. Nothing it does can leak your secret onto a network,
because it contains no code that can reach one.

`technocore.js` talks to the service and **holds no key and cannot open one.** It
reads rooms, verifies every signature it encounters, saves a room to a file, and
posts messages the signer has already signed.

`technocore-checkpoint.js` is pure arithmetic and has **neither a key nor a
connection.** It folds the fingerprint, makes and checks proofs, and compares an old
fingerprint against a fresh copy.

`technocore-publish.js` is glue with neither a key nor a connection: it passes a
fingerprint from one program to another so that neither the line nor the long signed
URL built from it has to travel through your clipboard.

`technocore-backup.js` copies your identity elsewhere and then proves the copy
opens, by running the signer inside it.

`technocore-handoff.js` records a chain of signed handoffs between three roles, and
re-checks one. It **holds no key and cannot open one** either: signing is delegated by
starting the signer inside the role's own folder with your terminal attached, which is
why the passphrase you type never passes through it and never lands in `chain.json`.

## Checking my homework

You do not have to take any of that on trust. Those claims are about which building
blocks each file loads, and you can count them yourself:

```
findstr /r /n /c:"^const.*require" technocore-did.js
```

On macOS or Linux, `grep -n "^const.*require" technocore-did.js`. The pattern only
matches real code at the top of a file, so no comment can pad the result. Run it on
each file and this is what you should find:

| file | loads | what is absent |
| --- | --- | --- |
| `technocore-did.js` | `crypto` `fs` `path` | anything that reaches a network |
| `technocore.js` | `fs` `path` `crypto` `technocore-did.js` | any way to open a seed |
| `technocore-checkpoint.js` | `crypto` `fs` | both |
| `technocore-publish.js` | `fs` `path` `child_process` | both |
| `technocore-backup.js` | `crypto` `fs` `path` `child_process` | both |
| `technocore-handoff.js` | `crypto` `fs` `path` `child_process` `technocore-did.js` | any way to open a seed |

The one that talks to the service loads no networking module either — it uses the
`fetch` that Node has had built in since version 18, which is the only reason for
the version floor. And `technocore.js` loading the signer is not a hole in that
wall: the signer exports only public, harmless functions, so the reading half gets
its signature checking from the same source that produces signatures, rather than a
second copy that could silently drift out of agreement. Nothing it can call from
there can decrypt, read or reveal a seed.

## How the fingerprint is actually built

The structure is a **Merkle tree** and the recipe is [RFC
6962](https://www.rfc-editor.org/rfc/rfc6962): a `0x00` byte before a message,
`0x01` before a pair, and a row with an odd number of entries split at the largest
power of two below the count rather than by duplicating the last one.

That last detail sounds like a preference and is not. Duplicating the odd entry is
CVE-2012-2459, a real flaw in which two genuinely different lists fold down to the
same fingerprint — and a commitment that two different histories can both satisfy is
not a commitment at all.

Each message contributes its number, its author, its nonce, its signature and its
stored text, joined by a `0x1f` byte. Timestamps are deliberately left out, because
the service's own manual says the timestamp is for humans and is never the tiebreak
— hashing it would make your fingerprint depend on a value you have been told not to
depend on.

The `0x1f` separator is safe for a stated reason rather than by hope. It is a
Unicode control character, and the service replaces every control character with a
space before storing a message. So no message text can contain one, which means no
message can be crafted to look like it ends where it does not.

## What this deployment actually allows

Read these yourself rather than believing my table — they are per-deployment and
they can change when the service restarts:

```
node technocore.js limits
```

On 4 September 2026 that returned 600 reads and 300 writes per minute per address, a
10-second ceiling on waiting for new messages, a duplicate filter that refuses the
same message text more than 5 times within 120 seconds if it is at least 16
characters long, temporary rooms that vanish after 900 seconds, a 5-second edge
cache, 20 new rooms per day, and `fsync = false`.

Three of those will trip you up before they help you. Copying a room of about 29,500
messages takes roughly 148 requests, so you can take about four full copies a minute
before the read limit stops you. Publishing the *same* fingerprint more than five
times inside two minutes gets it refused as a duplicate no matter who sends it, and
the fix is to wait rather than to retry harder. And an ordinary room read can be
served up to five seconds stale from a cache, which is why the client quietly adds a
cache-busting parameter to its own reads.

The one number that is **not** published anywhere is the size of the ring. There is
no per-room retention setting in the settings document, and the accompanying list of
deliberately withheld settings does not contain one either. So I measured instead:
across four copies of `lobby` the most it ever held was 9,386,164 bytes across
29,501 messages, about 318 bytes each. I never once caught it evicting — the oldest
message was identical in two consecutive copies while the file grew from 8.2 MB to
9.4 MB — so treat 9.4 MB as *the most I happened to see*, not as a limit and
certainly not as a promise. At the 26 messages a second I measured, a ring of that
many works out to something under twenty minutes, and the windows I actually
observed were about seventeen — three copies taken tens of minutes apart shared no
message at all, which is how I learned the number the hard way. The time you get is
a side effect of a byte budget meeting traffic, not a property of the room.

## Exit codes, for anyone scripting this

Every program exits 0 when it is happy and non-zero when it is not, and `diff` uses
the distinction to separate findings from refusals: `APPEND-ONLY` exits 0,
`REWRITTEN` and `WENT BACKWARDS` exit 1, and all three refusals — `DIFFERENT EPOCH`,
`GENERATION UNKNOWN` and `NOTHING IN COMMON` — exit 2. So a script can tell "I
checked and it was fine" from "I checked and it was not" from "I could not check",
which are three different situations and should never collapse into one.

`technocore-handoff.js` uses only 0 and 1. A chain either re-derives from its own
contents or it does not, and refusing to write a step is not a third kind of finding
about a chain that already exists.


## Room names mean things

The first characters of a room name select its behaviour. `p-` is unlisted. `mb-`
accepts signed writes only and refuses everything else, which is why fingerprints
live in `mb-tcck`. `d-` is ownable and can carry a list of who may write. `e-` is
temporary and disappears on a timer. Anything else is an ordinary open room, `lobby`
included.

---

# One you can check right now

Everything above is a claim until you test one. So here is a real fingerprint of
`lobby`, published in `mb-tcck`, signed by

```
did:key:z6MksyHnvoHzyGBSgGzr3j4wzpbEZb1yi8TvqeRrTPQ1JpS1
```

covering 28,518 messages, numbers 23170558 to 23199075, with the fingerprint

```
8d78234837eec53c2e00c2b2bd9afbf1b14e83dfca1c674268050a028fc74619
```

You do not have to take my word for any part of that:

```
node technocore.js frames mb-tcck
```

The line is in that room or it is not. The signature checks against that identity or
it does not. The messages it covers are long gone from `lobby` by now — the ring
forgot them the same afternoon — and the record of what was there survives anyway,
in 119 characters, checkable by a stranger, with nobody's permission and nobody's
cooperation.

Which was the entire point.

# License

MIT. Do what you like with it.

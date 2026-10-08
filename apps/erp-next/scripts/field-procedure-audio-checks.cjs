'use strict';
// Deterministic lifecycle checks, not microphone/codec acceptance.
const assert = require('node:assert/strict');
module.exports = async ({createProcedureAudioRecorder, PROCEDURE_AUDIO_MAX_SECONDS}) => {
  let cases = 0;
  function fixture(options = {}) {
    let time = Date.parse('2026-10-07T12:00:00Z'), allowed = true, resolve, requestCount = 0;
    const outputs = [], states = [], errors = [], timers = new Map(), tracks = [];
    let recorder, timerId = 0;
    function stream() {
      const track = {stopped: 0, listener: null, stop() { this.stopped++; }, addEventListener(_, fn) { this.listener = fn; }};
      tracks.push(track); return {getTracks: () => [track]};
    }
    const ports = {
      now: () => time,
      supports: mime => options.supports ? options.supports(mime) : mime.startsWith('audio/webm'),
      getMicrophone: () => { requestCount++; return options.foreignError ? Promise.reject(Object.freeze({name: 'NotAllowedError', message: 'synthetic cross-realm denial'})) : options.reject ? Promise.reject(new DOMException('synthetic', 'NotAllowedError')) : options.defer ? new Promise(r => { resolve = () => r(stream()); }) : Promise.resolve(stream()); },
      createRecorder: (_stream, mime) => recorder = {
        mimeType: mime, state: 'inactive', stops: 0,
        start() { if (options.startFailure) throw Error('synthetic start failure'); this.state = 'recording'; },
        stop() { this.stops++; if (options.stopFailure) throw Error('synthetic stop failure'); this.state = 'inactive'; },
        data(values) { this.ondataavailable?.({data: new Blob([new Uint8Array(values)], {type: mime})}); },
        finish(values = []) { this.data(values); this.state = 'inactive'; this.onstop?.(); },
      },
      startTimer: fn => { timers.set(++timerId, fn); return timerId; }, clearTimer: id => timers.delete(id),
    };
    const engine = createProcedureAudioRecorder(ports, {authorized: () => allowed, state: (...args) => states.push(args), original: value => outputs.push(value), error: value => errors.push(value)}, options.bytes || 128);
    return {engine, outputs, states, errors, tracks, timers, get recorder() { return recorder; }, get requests() { return requestCount; }, allow: value => { allowed = value; }, release: () => resolve(), advance: seconds => { time += seconds * 1000; for (const fn of [...timers.values()]) fn(); }};
  }
  let f = fixture(); f.allow(false); await f.engine.start(3); assert.equal(f.requests, 0); cases++;
  f = fixture({supports: () => false}); await f.engine.start(3); assert.equal(f.requests, 0); assert.equal(f.errors.length, 1); cases++;
  f = fixture({reject: true}); await f.engine.start(3); assert.equal(f.engine.busy(), false); assert.match(f.errors[0], /denegado/); cases++;
  f = fixture({foreignError: true}); await f.engine.start(3); assert.equal(f.engine.busy(), false); assert.match(f.errors[0], /denegado/); assert.equal(f.outputs.length, 0); cases++;
  f = fixture({defer: true}); const wait = f.engine.start(3); await f.engine.start(3); assert.equal(f.requests, 1); f.engine.stop(); f.release(); await wait; assert.ok(f.tracks.every(t => t.stopped)); assert.equal(f.outputs.length, 0); cases++;
  f = fixture({defer: true}); const disposed = f.engine.start(3); f.engine.dispose(); f.release(); await disposed; assert.ok(f.tracks.every(t => t.stopped)); assert.equal(f.outputs.length, 0); cases++;
  f = fixture({defer: true}); const changedOwner = f.engine.start(3); f.allow(false); f.release(); await changedOwner; assert.ok(f.tracks.every(t => t.stopped)); assert.equal(f.outputs.length, 0); cases++;
  f = fixture({startFailure: true}); await f.engine.start(3); assert.equal(f.engine.busy(), false); assert.ok(f.tracks.every(t => t.stopped)); cases++;
  f = fixture(); await f.engine.start(7); f.recorder.data([1, 2]); f.advance(2); f.engine.stop(); f.engine.stop(); assert.equal(f.recorder.stops, 1); assert.equal(f.outputs.length, 0, 'wait for final data, not merely stop() return'); f.recorder.finish([3, 4]); assert.equal(f.outputs.length, 1); assert.deepEqual([...new Uint8Array(await f.outputs[0].blob.arrayBuffer())], [1, 2, 3, 4]); assert.equal(f.outputs[0].safetyRevision, 7); assert.equal(f.outputs[0].durationSeconds, 2); assert.equal(f.outputs[0].interrupted, false); assert.equal(f.timers.size, 0); cases++;
  f = fixture({supports: mime => mime === 'audio/mp4'}); await f.engine.start(4); f.engine.stop(); f.recorder.finish([1]); assert.equal(f.outputs[0].blob.type, 'audio/mp4'); cases++;
  f = fixture({bytes: 10}); await f.engine.start(1); f.recorder.data([1,2,3,4,5,6,7,8]); assert.equal(f.recorder.stops, 1); f.recorder.finish([9,10,11]); assert.equal(f.outputs[0].blob.size, 11, 'do not truncate an oversize original'); assert.equal(f.outputs[0].interrupted, true); cases++;
  f = fixture(); await f.engine.start(1); f.advance(PROCEDURE_AUDIO_MAX_SECONDS); assert.equal(f.recorder.stops, 1); f.recorder.finish([1]); assert.equal(f.outputs[0].interrupted, true); cases++;
  f = fixture(); await f.engine.start(1); f.engine.stop(true); f.recorder.finish([1]); assert.equal(f.outputs[0].interrupted, true); assert.ok(f.tracks.every(t => t.stopped)); cases++;
  f = fixture(); await f.engine.start(1); f.engine.stop(); f.recorder.finish(); assert.equal(f.outputs.length, 0); assert.match(f.errors[0], /vacía/); cases++;
  f = fixture(); await f.engine.start(1); f.recorder.data([1]); f.engine.dispose(); f.recorder.finish([2]); assert.equal(f.outputs.length, 0); assert.ok(f.tracks.every(t => t.stopped)); cases++;
  f = fixture(); await f.engine.start(1); f.allow(false); f.advance(1); assert.equal(f.recorder.stops, 1); f.recorder.finish([1]); assert.equal(f.outputs[0].safetyRevision, 1); cases++;
  f = fixture({stopFailure: true}); await f.engine.start(1); f.recorder.data([1]); f.engine.stop(); assert.equal(f.outputs.length, 1); assert.equal(f.outputs[0].interrupted, true); assert.equal(f.engine.busy(), false); cases++;
  f = fixture(); await f.engine.start(1); f.engine.stop(); f.recorder.finish([1]); const oldTrack = f.tracks[0]; await f.engine.start(2); oldTrack.listener(); assert.equal(f.recorder.stops, 0, 'late old-track event cannot stop new recording'); f.engine.dispose(); cases++;
  f = fixture(); await f.engine.start(1); const oldStop = f.recorder.onstop; f.engine.stop(); f.recorder.finish([1]); await f.engine.start(2); oldStop(); assert.equal(f.outputs.length, 1, 'late old-stop callback cannot finalize the new recording'); assert.equal(f.engine.busy(), true); f.engine.dispose(); cases++;
  console.log('PASS ' + cases + ' audio recorder lifecycle checks'); return cases;
};

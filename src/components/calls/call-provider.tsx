"use client";

import { createContext, useContext, useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import { publicStorageUrl } from "@/lib/storage";
import { getBrowserClient, getRealtimeClient } from "@/lib/supabase/client";
import type { Database, Json } from "@/lib/supabase/types";
import { callIceServersAction } from "@/server/calls";
import { findAudioRoute, isPhone, type AudioRoute, type NoRoute } from "./audio-route";
import { CallScreen } from "./call-screen";
import { playTone, vibrateRing } from "./tones";

/**
 * Voice calls between the two members of a direct conversation.
 *
 * The sound goes browser to browser (WebRTC). The database rings the other
 * person (a `calls` row), carries the connection set-up between the two
 * browsers (`call_signals`), and records how the call ended. Both arrive live
 * through Supabase Realtime, with check-ins every few seconds as a fallback,
 * so a missed live update can't leave a call hanging.
 *
 * Mounted once in the layout, so a call carries on while the person moves
 * between pages. A call rings only where the site is open; otherwise the
 * person called gets a missed-call notification.
 */

export interface CallPeer {
  id: string;
  name: string;
  avatarUrl: string | null;
}

type CallRow = Database["public"]["Tables"]["calls"]["Row"];
type SignalRow = Database["public"]["Tables"]["call_signals"]["Row"];

export type CallPhase = "idle" | "outgoing" | "incoming" | "connecting" | "active" | "ended";
export type CallNote = "ended" | "noAnswer" | "busy" | "failed" | "micDenied" | "unsupported" | "blocked" | "unavailable" | "rateLimited" | "error";
export type SpeakerNote = NoRoute | "failed";

export interface CallView {
  phase: CallPhase;
  peer: CallPeer | null;
  /** Calling: the other person's phone is ringing (the call exists). */
  ringing: boolean;
  connectedAt: number | null;
  durationAtEnd: number | null;
  note: CallNote | null;
  muted: boolean;
  /** A phone: the call has a speaker button, on both sides (see audio-route.ts). */
  speakerAvailable: boolean;
  /** The sound plays from the loudspeaker (rather than the earpiece). */
  speaker: boolean;
  /** Why the last press couldn't move the sound, said for a few seconds. */
  speakerNote: SpeakerNote | null;
  reconnecting: boolean;
  minimized: boolean;
}

const IDLE: CallView = {
  phase: "idle",
  peer: null,
  ringing: false,
  connectedAt: null,
  durationAtEnd: null,
  note: null,
  muted: false,
  speakerAvailable: false,
  speaker: true,
  speakerNote: null,
  reconnecting: false,
  minimized: false,
};

interface CallApi {
  /** A direct conversation's id, or null to open (or create) the one with `peer` first. */
  start: (conversationId: string | null, peer: CallPeer) => void;
  busy: boolean;
}

const CallContext = createContext<CallApi | null>(null);
/** Null when signed out (no calls). */
export const useCall = () => useContext(CallContext);

const HEARTBEAT_MS = 8_000;
const INCOMING_CHECK_MS = 4_000;
const RING_TIMEOUT_MS = 45_000;
const INCOMING_TIMEOUT_MS = 55_000;
const CONNECT_TIMEOUT_MS = 30_000;
const RECONNECT_GRACE_MS = 15_000;
const SUBSCRIBE_WAIT_MS = 5_000;
const NOTE_MS = 2_600;
const OPEN_STATUSES = ["ringing", "active"];

function supported(): boolean {
  return typeof window !== "undefined" && typeof RTCPeerConnection !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
}

/** What the caller is told when the database refuses the call. */
function noteFor(message: string): CallNote {
  if (message === "user_busy") return "busy";
  if (message === "user_blocked") return "blocked";
  if (message === "rate_limited") return "rateLimited";
  if (["user_not_found", "conversation_not_found", "conversation_locked", "profile_incomplete"].includes(message)) return "unavailable";
  return "error";
}

interface Live {
  me: string | null;
  callId: string | null;
  role: "caller" | "callee" | null;
  phase: CallPhase;
  connectedAt: number | null;
  pc: RTCPeerConnection | null;
  peerWait: Promise<RTCPeerConnection | null>;
  peerResolve: (pc: RTCPeerConnection | null) => void;
  local: MediaStream | null;
  channel: RealtimeChannel | null;
  seen: Set<number>;
  chain: Promise<void>;
  pending: RTCIceCandidateInit[];
  ice: Promise<RTCIceServer[]> | null;
  timeouts: Set<number>;
  heartbeat: number | null;
  tone: { stop: () => void } | null;
  buzz: { stop: () => void } | null;
  token: string | null;
  offered: boolean;
  muted: boolean;
  route: AudioRoute | null;
  speakerOn: boolean;
  /** iPhone: the call set Safari's audio session, to put back afterwards. */
  sessionSet: boolean;
  /** Bumped when a call ends, so late answers from an old call are ignored. */
  generation: number;
}

function newLive(): Live {
  const live = {
    me: null,
    callId: null,
    role: null,
    phase: "idle",
    connectedAt: null,
    pc: null,
    peerResolve: () => undefined,
    local: null,
    channel: null,
    seen: new Set<number>(),
    chain: Promise.resolve(),
    pending: [],
    ice: null,
    timeouts: new Set<number>(),
    heartbeat: null,
    tone: null,
    buzz: null,
    token: null,
    offered: false,
    muted: false,
    route: null,
    speakerOn: true,
    sessionSet: false,
    generation: 0,
  } as unknown as Live;
  live.peerWait = new Promise((resolve) => (live.peerResolve = resolve));
  return live;
}

/** Safari's Audio Session API (iPhone, iPad), when there is one. */
function audioSession(): { type: string } | null {
  if (typeof navigator === "undefined") return null;
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  return session && typeof session === "object" ? session : null;
}

/** Points an <audio> element at an output (Safari 18.4+ allows it only straight after a tap). */
function sinkOf(el: HTMLAudioElement, deviceId: string): Promise<void> {
  return (el as HTMLAudioElement & { setSinkId: (id: string) => Promise<void> }).setSinkId(deviceId);
}

/** Whether this phone lets the page choose loudspeaker or earpiece now, and how. */
async function detectRoute(): Promise<AudioRoute | NoRoute> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return findAudioRoute(devices, { setSinkId: typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype });
  } catch {
    return "unsupported";
  }
}

function getMic(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
}

function createEngine(setView: Dispatch<SetStateAction<CallView>>) {
  const live = newLive();
  /** The hidden <audio> element that plays the other person's voice. */
  let audioEl: HTMLAudioElement | null = null;
  const L = () => live;
  const db = () => getBrowserClient();
  const patch = (p: Partial<CallView>) => setView((v) => ({ ...v, ...p }));
  const setPhase = (phase: CallPhase, p: Partial<CallView> = {}) => {
    L().phase = phase;
    patch({ phase, ...p });
  };
  const later = (fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      L().timeouts.delete(id);
      fn();
    }, ms);
    L().timeouts.add(id);
  };
  const current = (gen: number) => L().generation === gen;

  function stopSounds() {
    L().tone?.stop();
    L().tone = null;
    L().buzz?.stop();
    L().buzz = null;
  }

  /** Releases everything the call held: microphone, connection, live updates, timers, sounds. */
  function teardown() {
    const l = L();
    l.generation++;
    stopSounds();
    for (const id of l.timeouts) window.clearTimeout(id);
    l.timeouts.clear();
    if (l.heartbeat) window.clearInterval(l.heartbeat);
    l.heartbeat = null;
    if (l.pc) {
      l.pc.onicecandidate = null;
      l.pc.ontrack = null;
      l.pc.onconnectionstatechange = null;
      l.pc.oniceconnectionstatechange = null;
      l.pc.close();
    }
    l.pc = null;
    l.peerResolve(null);
    l.peerWait = new Promise((resolve) => (l.peerResolve = resolve));
    l.local?.getTracks().forEach((track) => track.stop());
    l.local = null;
    if (l.channel) void db().removeChannel(l.channel);
    l.channel = null;
    if (audioEl) audioEl.srcObject = null;
    l.callId = null;
    l.role = null;
    l.seen = new Set();
    l.chain = Promise.resolve();
    l.pending = [];
    l.ice = null;
    l.offered = false;
    l.connectedAt = null;
    // The next call starts on the loudspeaker; Safari's audio session goes back to its default.
    if (l.route?.kind === "output" && !l.speakerOn && audioEl) void sinkOf(audioEl, l.route.speaker).catch(() => undefined);
    if (l.sessionSet) {
      const session = audioSession();
      if (session) session.type = "auto";
    }
    l.sessionSet = false;
    l.muted = false;
    l.route = null;
    l.speakerOn = true;
  }

  /** Closes the call screen, after a short note when there is something to say. */
  function finish(note: CallNote | null) {
    const started = L().connectedAt;
    const duration = started ? Math.round((Date.now() - started) / 1000) : null;
    teardown();
    if (!note) {
      L().phase = "idle";
      setView(IDLE);
      return;
    }
    L().phase = "ended";
    setView((v) => ({ ...IDLE, phase: "ended", peer: v.peer, note, durationAtEnd: note === "ended" ? duration : null }));
    const gen = L().generation;
    later(() => {
      if (current(gen) && L().phase === "ended") {
        L().phase = "idle";
        setView(IDLE);
      }
    }, NOTE_MS);
  }

  async function endOnServer(callId: string | null, reason: "hangup" | "decline" | "failed" | "timeout") {
    if (callId) await db().rpc("end_call", { p_call_id: callId, p_reason: reason });
  }

  async function rememberToken() {
    const { data } = await db().auth.getSession();
    L().token = data.session?.access_token ?? null;
  }

  function startHeartbeat(ms: number) {
    const l = L();
    const gen = l.generation;
    const id = l.callId;
    if (l.heartbeat) window.clearInterval(l.heartbeat);
    l.heartbeat = window.setInterval(async () => {
      if (!current(gen) || !id) return;
      void rememberToken();
      const { data, error } = await db().rpc("call_heartbeat", { p_call_id: id });
      if (!current(gen) || error) return;
      onStatus(id, String(data));
      // Set-up messages a live update may have dropped.
      if (current(gen) && L().phase === "connecting") void catchUp(id, gen);
    }, ms);
  }

  /** The current call's status, from a live update or a check-in. */
  function onStatus(callId: string, status: string) {
    const l = L();
    if (callId !== l.callId) return;
    if (status === "active") {
      if (l.role === "caller" && l.phase === "outgoing") void connectAsCaller();
      // Picked up on another of this person's devices.
      else if (l.role === "callee" && l.phase === "incoming") finish(null);
      return;
    }
    if (OPEN_STATUSES.includes(status)) return;
    if (l.phase === "incoming") return finish(null);
    if (status === "ended") return finish("ended");
    if (status === "failed") return finish("failed");
    finish(l.role === "caller" ? "noAnswer" : null);
  }

  function onRow(row: CallRow) {
    const l = L();
    if (!l.me) return;
    if (row.id === l.callId) return onStatus(row.id, row.status);
    if (row.callee_id === l.me && row.status === "ringing" && (l.phase === "idle" || l.phase === "ended")) void ring(row);
  }

  /** Someone is calling: show it, ring, and wait for an answer. */
  async function ring(row: CallRow) {
    teardown();
    const l = L();
    const gen = l.generation;
    l.callId = row.id;
    l.role = "callee";
    setView({ ...IDLE, phase: "incoming", peer: { id: row.caller_id, name: "", avatarUrl: null } });
    l.phase = "incoming";
    l.tone = playTone("ring");
    l.buzz = vibrateRing();
    later(() => {
      if (current(gen) && L().phase === "incoming") {
        void endOnServer(row.id, "timeout");
        finish(null);
      }
    }, INCOMING_TIMEOUT_MS);
    startHeartbeat(INCOMING_CHECK_MS);
    const { data } = await db().from("profiles").select("display_name, avatar_path").eq("id", row.caller_id).maybeSingle();
    if (current(gen)) patch({ peer: { id: row.caller_id, name: data?.display_name ?? "", avatarUrl: publicStorageUrl("avatars", data?.avatar_path) } });
  }

  /** A call that started ringing before this page opened. */
  async function checkWaiting() {
    const l = L();
    if (!l.me || l.phase !== "idle") return;
    const { data } = await db().from("calls").select("*").eq("callee_id", l.me).eq("status", "ringing").order("created_at", { ascending: false }).limit(1);
    const row = data?.[0];
    if (!row || L().phase !== "idle") return;
    // The check-in closes a call that rang out long ago instead of ringing again.
    const { data: status } = await db().rpc("call_heartbeat", { p_call_id: row.id });
    if (status === "ringing" && L().phase === "idle") void ring(row);
  }

  /** Live updates for calls to and from this person. */
  function watch(me: string | null) {
    if (!me) return;
    L().me = me;
    let channel: RealtimeChannel | null = null;
    let closed = false;
    // Joined as this person (RLS decides which calls reach them), once the session has loaded.
    void getRealtimeClient().then((client) => {
      if (closed) return;
      channel = client
        .channel(`calls:${me}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "calls", filter: `callee_id=eq.${me}` }, (p) => onRow(p.new as CallRow))
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "calls", filter: `callee_id=eq.${me}` }, (p) => onRow(p.new as CallRow))
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "calls", filter: `caller_id=eq.${me}` }, (p) => onRow(p.new as CallRow))
        .subscribe((status) => {
          if (status === "SUBSCRIBED") void checkWaiting();
        });
    });
    return () => {
      closed = true;
      if (channel) void db().removeChannel(channel);
      const l = L();
      if (l.callId) {
        void endOnServer(l.callId, l.phase === "incoming" ? "decline" : "hangup");
        finish(null);
      }
      l.me = null;
    };
  }

  /** Listens for the other browser's set-up messages, and reads any already sent. */
  async function openSignals(callId: string, gen: number) {
    const client = await getRealtimeClient();
    if (!current(gen)) return;
    await new Promise<void>((resolve) => {
      L().channel = client
        .channel(`call:${callId}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "call_signals", filter: `call_id=eq.${callId}` }, (p) => onSignal(p.new as SignalRow, gen))
        .subscribe((status) => {
          if (status === "SUBSCRIBED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") resolve();
        });
      later(resolve, SUBSCRIBE_WAIT_MS);
    });
    if (current(gen)) await catchUp(callId, gen);
  }

  async function catchUp(callId: string, gen: number) {
    const { data } = await db().from("call_signals").select("*").eq("call_id", callId).order("id");
    if (!current(gen)) return;
    for (const row of data ?? []) onSignal(row, gen);
  }

  /** Handles set-up messages one at a time, in order. */
  function onSignal(row: SignalRow, gen: number) {
    const l = L();
    if (!current(gen) || row.sender_id === l.me || l.seen.has(row.id)) return;
    l.seen.add(row.id);
    l.chain = l.chain.then(() => handleSignal(row, gen)).catch(() => undefined);
  }

  async function handleSignal(row: SignalRow, gen: number) {
    const pc = await L().peerWait;
    if (!pc || !current(gen)) return;
    const payload = row.payload as Record<string, unknown>;
    if (row.kind === "offer" && L().role === "callee") {
      await pc.setRemoteDescription(payload as unknown as RTCSessionDescriptionInit);
      await flushCandidates(pc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await sendSignal("answer", { type: answer.type, sdp: answer.sdp ?? "" });
    } else if (row.kind === "answer" && L().role === "caller") {
      if (pc.signalingState !== "have-local-offer") return;
      await pc.setRemoteDescription(payload as unknown as RTCSessionDescriptionInit);
      await flushCandidates(pc);
    } else if (row.kind === "candidate") {
      if (pc.remoteDescription) await pc.addIceCandidate(payload as RTCIceCandidateInit).catch(() => undefined);
      else L().pending.push(payload as RTCIceCandidateInit);
    }
  }

  async function flushCandidates(pc: RTCPeerConnection) {
    const queued = L().pending.splice(0);
    for (const candidate of queued) await pc.addIceCandidate(candidate).catch(() => undefined);
  }

  async function sendSignal(kind: "offer" | "answer" | "candidate", payload: Record<string, unknown>) {
    const id = L().callId;
    if (id) await db().rpc("send_call_signal", { p_call_id: id, p_kind: kind, p_payload: payload as Json });
  }

  /** The browser-to-browser connection, with the microphone attached. */
  async function createPeer(gen: number): Promise<RTCPeerConnection | null> {
    const l = L();
    const callId = l.callId;
    if (!callId) return null;
    const servers = await (l.ice ??= callIceServersAction(callId));
    if (!current(gen)) return null;
    const pc = new RTCPeerConnection({ iceServers: servers });
    l.pc = pc;
    const local = l.local;
    if (local) for (const track of local.getTracks()) pc.addTrack(track, local);
    pc.onicecandidate = (e) => {
      if (e.candidate && current(gen)) void sendSignal("candidate", e.candidate.toJSON() as Record<string, unknown>);
    };
    pc.ontrack = (e) => {
      if (!audioEl) return;
      audioEl.srcObject = e.streams[0] ?? new MediaStream([e.track]);
      void audioEl.play().catch(() => undefined);
    };
    const onState = () => {
      if (!current(gen)) return;
      const ice = pc.iceConnectionState;
      const state = pc.connectionState;
      if (state === "connected" || ice === "connected" || ice === "completed") connected();
      else if (state === "failed" || ice === "failed") failed(gen);
      else if (state === "disconnected" || ice === "disconnected") disconnected(gen, pc);
    };
    pc.onconnectionstatechange = onState;
    pc.oniceconnectionstatechange = onState;
    l.peerResolve(pc);
    return pc;
  }

  function connected() {
    const l = L();
    if (l.phase === "active") return patch({ reconnecting: false });
    l.connectedAt = Date.now();
    setPhase("active", { connectedAt: l.connectedAt, reconnecting: false });
  }

  function failed(gen: number) {
    if (!current(gen)) return;
    void endOnServer(L().callId, "failed");
    finish("failed");
  }

  function disconnected(gen: number, pc: RTCPeerConnection) {
    patch({ reconnecting: true });
    later(() => {
      if (current(gen) && (pc.connectionState === "disconnected" || pc.iceConnectionState === "disconnected")) failed(gen);
    }, RECONNECT_GRACE_MS);
  }

  function armConnectTimeout(gen: number) {
    later(() => {
      if (current(gen) && L().phase !== "active") failed(gen);
    }, CONNECT_TIMEOUT_MS);
  }

  /** The other person picked up: the caller starts the connection. */
  async function connectAsCaller() {
    const l = L();
    if (l.offered) return;
    l.offered = true;
    const gen = l.generation;
    l.tone?.stop();
    l.tone = null;
    setPhase("connecting");
    armConnectTimeout(gen);
    const pc = await createPeer(gen);
    if (!pc || !current(gen)) return;
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await sendSignal("offer", { type: offer.type, sdp: offer.sdp ?? "" });
    } catch {
      failed(gen);
    }
  }

  /** Calls the other member of a direct conversation; without one (from a player's page), opens it first. */
  async function start(conversationId: string | null, peer: CallPeer) {
    const l = L();
    if (!l.me || (l.phase !== "idle" && l.phase !== "ended")) return;
    teardown();
    const gen = l.generation;
    setView({ ...IDLE, phase: "outgoing", peer });
    l.phase = "outgoing";
    if (!supported()) return finish("unsupported");
    // The microphone first: no point ringing someone who can't hear us.
    let stream: MediaStream;
    try {
      stream = await getMic();
    } catch {
      if (current(gen)) finish("micDenied");
      return;
    }
    if (!current(gen)) return stream.getTracks().forEach((track) => track.stop());
    l.local = stream;
    void rememberToken();
    await prepareRoute(gen);
    if (!current(gen)) return;
    let conversation = conversationId;
    if (!conversation) {
      // The same conversation «مراسلة» opens; it is where the call's record goes.
      const { data: opened, error: openError } = await db().rpc("start_direct_conversation", { p_user_id: peer.id });
      if (!current(gen)) return;
      if (openError || !opened) return finish(noteFor(openError?.message ?? ""));
      conversation = String(opened);
    }
    const { data, error } = await db().rpc("start_call", { p_conversation_id: conversation });
    if (!current(gen)) {
      // Hung up while it was being placed.
      if (data) void endOnServer(String(data), "hangup");
      return;
    }
    if (error || !data) return finish(noteFor(error?.message ?? ""));
    const callId = String(data);
    l.callId = callId;
    l.role = "caller";
    patch({ ringing: true });
    l.tone = playTone("ringback");
    l.ice = callIceServersAction(callId);
    startHeartbeat(HEARTBEAT_MS);
    later(() => {
      if (current(gen) && L().phase === "outgoing") {
        void endOnServer(callId, "timeout");
        finish("noAnswer");
      }
    }, RING_TIMEOUT_MS);
    void openSignals(callId, gen);
  }

  async function accept() {
    const l = L();
    const callId = l.callId;
    if (l.phase !== "incoming" || !callId) return;
    const gen = l.generation;
    stopSounds();
    setPhase("connecting");
    let stream: MediaStream;
    try {
      stream = await getMic();
    } catch {
      if (current(gen)) {
        void endOnServer(callId, "decline");
        finish("micDenied");
      }
      return;
    }
    if (!current(gen)) return stream.getTracks().forEach((track) => track.stop());
    l.local = stream;
    void rememberToken();
    l.ice = callIceServersAction(callId);
    await prepareRoute(gen);
    if (!current(gen)) return;
    // Listen before picking up, so the caller's first message can't slip past.
    await openSignals(callId, gen);
    if (!current(gen)) return;
    const { data: status, error } = await db().rpc("answer_call", { p_call_id: callId });
    if (!current(gen)) return;
    if (error || status !== "active") return finish(error ? "error" : null);
    startHeartbeat(HEARTBEAT_MS);
    armConnectTimeout(gen);
    await createPeer(gen);
  }

  function decline() {
    void endOnServer(L().callId, "decline");
    finish(null);
  }

  function hangUp() {
    const l = L();
    const wasTalking = l.phase === "active";
    void endOnServer(l.callId, "hangup");
    finish(wasTalking ? "ended" : null);
  }

  function toggleMute() {
    const l = L();
    const track = l.local?.getAudioTracks()[0];
    if (!track) return;
    l.muted = !l.muted;
    track.enabled = !l.muted;
    patch({ muted: l.muted });
  }

  /**
   * Every phone gets the speaker button, on both sides of the call. Calls
   * start on the loudspeaker (where iPhone and Android put them), so the
   * screen and its buttons stay in view rather than against the cheek. Whether
   * the phone lets the page move the sound is found now, and again on a press
   * if it wasn't then.
   */
  async function prepareRoute(gen: number) {
    if (typeof window.matchMedia !== "function" || !isPhone(navigator.userAgent, window.matchMedia("(pointer: coarse)").matches)) return;
    const l = L();
    // iPhone: keep the call's audio session steady for its whole length.
    const session = audioSession();
    if (session) {
      session.type = "play-and-record";
      l.sessionSet = true;
    }
    l.speakerOn = true;
    patch({ speakerAvailable: true, speaker: true, speakerNote: null });
    const found = await detectRoute();
    if (!current(gen)) return;
    l.route = typeof found === "string" ? null : found;
    // A call that ended on the earpiece left its <audio> there: back to the loudspeaker (right after the tap that placed or answered this one).
    if (l.route?.kind === "output" && audioEl) {
      const sink = (audioEl as HTMLAudioElement & { sinkId?: string }).sinkId;
      if (sink && sink !== l.route.speaker) await sinkOf(audioEl, l.route.speaker).catch(() => undefined);
    }
  }

  /** Points the sound at the loudspeaker (on) or the earpiece (off). */
  async function applyRoute(on: boolean, gen: number): Promise<boolean> {
    const l = L();
    const route = l.route;
    if (!route) return false;
    const target = on ? route.speaker : route.earpiece;
    if (route.kind === "output") {
      if (!audioEl) return false;
      // First thing on the tap: Safari allows it only straight after one.
      await sinkOf(audioEl, target);
    } else {
      // Android: the sound follows the microphone, and only one microphone opens
      // at a time, so close the current one first.
      l.local?.getTracks().forEach((old) => old.stop());
      const constraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
      let stream: MediaStream;
      let switched = true;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: target }, ...constraints }, video: false });
      } catch {
        // That microphone wouldn't open: reopen the default one, so the call keeps its sound.
        stream = await navigator.mediaDevices.getUserMedia({ audio: constraints, video: false });
        switched = false;
      }
      if (!current(gen)) {
        stream.getTracks().forEach((track) => track.stop());
        return false;
      }
      const track = stream.getAudioTracks()[0];
      track.enabled = !l.muted;
      const sender = l.pc?.getSenders().find((s) => s.track === null || s.track.kind === "audio");
      if (sender) await sender.replaceTrack(track);
      l.local = stream;
      if (!switched) return false;
    }
    l.speakerOn = on;
    return true;
  }

  /** Says for a few seconds why the sound couldn't move. */
  function speakerNote(note: SpeakerNote, gen: number) {
    patch({ speakerNote: note });
    later(() => {
      if (current(gen)) patch({ speakerNote: null });
    }, 5000);
  }

  function toggleSpeaker() {
    const l = L();
    const gen = l.generation;
    void (async () => {
      if (!l.route) {
        // Not offered when the call started (or headphones since unplugged): look again.
        const found = await detectRoute();
        if (!current(gen)) return;
        if (typeof found === "string") return speakerNote(found, gen);
        l.route = found;
      }
      const next = !l.speakerOn;
      const done = await applyRoute(next, gen).catch(() => false);
      if (!current(gen)) return;
      if (done) patch({ speaker: next, speakerNote: null });
      else speakerNote("failed", gen);
    })();
  }

  function dismiss() {
    if (L().phase !== "ended") return;
    L().phase = "idle";
    setView(IDLE);
  }

  /** Closing or leaving the page hangs up at once, instead of the other side waiting for a check-in to lapse. */
  function hangUpOnLeave() {
    const onLeave = () => {
      const l = L();
      if (!l.callId || !l.token || !["outgoing", "connecting", "active"].includes(l.phase)) return;
      try {
        void fetch(`${publicEnv.supabaseUrl}/rest/v1/rpc/end_call`, {
          method: "POST",
          keepalive: true,
          headers: { apikey: publicEnv.supabaseAnonKey, Authorization: `Bearer ${l.token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ p_call_id: l.callId, p_reason: "hangup" }),
        });
      } catch {
        // the check-ins will close it
      }
    };
    window.addEventListener("pagehide", onLeave);
    return () => window.removeEventListener("pagehide", onLeave);
  }

  return {
    watch,
    start,
    accept,
    decline,
    hangUp,
    toggleMute,
    toggleSpeaker,
    dismiss,
    hangUpOnLeave,
    minimize: (minimized: boolean) => patch({ minimized }),
    attachAudio: (el: HTMLAudioElement | null) => {
      audioEl = el;
    },
  };
}

export function CallProvider({ me, children }: { me: string | null; children: ReactNode }) {
  const [view, setView] = useState<CallView>(IDLE);
  const [engine] = useState(() => createEngine(setView));

  useEffect(() => engine.watch(me), [engine, me]);
  useEffect(() => engine.hangUpOnLeave(), [engine]);

  const busy = view.phase !== "idle" && view.phase !== "ended";
  const api = useMemo<CallApi>(() => ({ start: (c, p) => void engine.start(c, p), busy }), [engine, busy]);

  return (
    <CallContext.Provider value={me ? api : null}>
      {children}
      {me ? (
        <>
          {/* The other person's voice. */}
          <audio ref={(el) => engine.attachAudio(el)} autoPlay playsInline className="hidden" />
          <CallScreen
            view={view}
            onAccept={() => void engine.accept()}
            onDecline={engine.decline}
            onHangUp={engine.hangUp}
            onMute={engine.toggleMute}
            onSpeaker={engine.toggleSpeaker}
            onMinimize={engine.minimize}
            onDismiss={engine.dismiss}
          />
        </>
      ) : null}
    </CallContext.Provider>
  );
}

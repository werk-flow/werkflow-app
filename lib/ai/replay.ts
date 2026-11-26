import 'server-only';

import { APICallError } from 'ai';

import type { AiModel } from '@/lib/ai/model';

/**
 * Recorded synthetic model streams for tests and local runs: no key, no
 * network, no cost (check 4 of werk-flow/werkflow-planning#20). A user message
 * that starts with `[replay:<name>]` picks a transcript; any other message gets
 * the plain answer. Each transcript is the provider's answer to each attempt,
 * in order; the last one repeats.
 */
export const AI_REPLAY_PROVIDER = 'werkflow.replay';

type StreamOptions = Parameters<AiModel['doStream']>[0];
type StreamResult = Awaited<ReturnType<AiModel['doStream']>>;
type StreamPart = StreamResult['stream'] extends ReadableStream<infer Part> ? Part : never;
type FinishPart = Extract<StreamPart, { type: 'finish' }>;

type ReplayAttempt = (userText: string) => StreamPart[] | APICallError;

function finish(reason: 'stop' | 'tool-calls', inputTokens: number, outputTokens: number): FinishPart {
  return {
    type: 'finish',
    finishReason: { unified: reason, raw: reason === 'stop' ? 'end_turn' : 'tool_use' },
    usage: {
      inputTokens: { total: inputTokens, noCache: inputTokens - 200, cacheRead: 200, cacheWrite: 0 },
      outputTokens: { total: outputTokens, text: outputTokens, reasoning: 0 },
    },
  };
}

function text(...deltas: string[]): StreamPart[] {
  return [
    { type: 'text-start', id: 'text' },
    ...deltas.map((delta): StreamPart => ({ type: 'text-delta', id: 'text', delta })),
    { type: 'text-end', id: 'text' },
  ];
}

function toolCall(toolName: string, input: object): StreamPart {
  return { type: 'tool-call', toolCallId: `call-${toolName}`, toolName, input: JSON.stringify(input) };
}

function providerError(statusCode: number, responseBody: string): APICallError {
  return new APICallError({
    message: `replayed provider error ${statusCode}`,
    url: 'replay://messages',
    requestBodyValues: {},
    statusCode,
    responseBody,
    isRetryable: statusCode === 429 || statusCode >= 500,
  });
}

const answer: ReplayAttempt = () => [
  ...text(
    'Hallo! Ich bin WerkFlow KI. ',
    'Hier läuft kein Modell, ',
    'deshalb antworte ich aus einer Aufzeichnung.',
  ),
  finish('stop', 900, 40),
];

const TRANSCRIPTS: Readonly<Record<string, readonly ReplayAttempt[]>> = {
  antwort: [answer],
  echo: [(userText) => [...text('Du hast geschrieben: ', userText), finish('stop', 900, 60)]],
  // Injection case (B21): the model was told to mail a customer and calls a tool
  // that does not exist, again and again. No tool runs; the step limit ends it.
  schleife: [
    () => [
      ...text('Ich schicke die Unterlagen jetzt an den Kunden. '),
      toolCall('mail_senden', { an: 'kunde@example.com', anhang: 'alle Angebote' }),
      finish('tool-calls', 1200, 80),
    ],
  ],
  'zwei-schritte': [
    () => [toolCall('auftrag_lesen', { auftrag: 'A-1001' }), finish('tool-calls', 1100, 30)],
    () => [...text('Der Auftrag ist erledigt.'), finish('stop', 1300, 20)],
  ],
  ueberlastet: [() => providerError(529, '{"type":"error","error":{"type":"overloaded_error"}}'), answer],
  ausgabenlimit: [
    () =>
      providerError(
        429,
        '{"type":"error","error":{"type":"rate_limit_error","details":{"error_code":"enforced_spend_limit_reached"}}}',
      ),
  ],
  'guthaben-leer': [
    () =>
      providerError(
        400,
        '{"type":"error","error":{"type":"invalid_request_error","message":"credit balance"}}',
      ),
  ],
  // A stream that breaks after it began: what the user saw stays, nothing is retried.
  abbruch: [
    () => [
      ...text('Ich fange an'),
      { type: 'error', error: { type: 'overloaded_error' } },
      finish('stop', 900, 10),
    ],
  ],
  // A provider failure whose body quotes the user's message: it must never reach a log (B17).
  'echo-fehler': [(userText) => providerError(500, JSON.stringify({ error: { message: userText } }))],
};

function latestUserText(options: StreamOptions): string {
  for (let index = options.prompt.length - 1; index >= 0; index -= 1) {
    const message = options.prompt[index];
    if (message?.role !== 'user') continue;
    return message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('');
  }
  return '';
}

/** A fresh replay model per turn: it counts the turn's attempts to pick each answer. */
export function createReplayModel(modelId: string): AiModel {
  let attempts = 0;
  return {
    specificationVersion: 'v4',
    provider: AI_REPLAY_PROVIDER,
    modelId,
    supportedUrls: {},
    doGenerate() {
      throw new Error('replay_stream_only');
    },
    doStream(options) {
      const userText = latestUserText(options);
      const name = /^\[replay:([a-z-]+)\]\s*/.exec(userText);
      const transcript = TRANSCRIPTS[name?.[1] ?? 'antwort'] ?? [answer];
      const attempt = transcript[Math.min(attempts, transcript.length - 1)] ?? answer;
      attempts += 1;
      const outcome = attempt(name ? userText.slice(name[0].length) : userText);
      if (outcome instanceof APICallError) return Promise.reject(outcome);
      const parts: StreamPart[] = [{ type: 'stream-start', warnings: [] }, ...outcome];
      return Promise.resolve({
        stream: new ReadableStream<StreamPart>({
          start(controller) {
            for (const part of parts) controller.enqueue(part);
            controller.close();
          },
        }),
      });
    },
  };
}

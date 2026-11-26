import { expect, test } from 'bun:test';

import { AI_MODEL_PRICE, costMicroUsd } from './cost';
import { AI_TURN_LIMITS, estimateInputTokens, maxTurnCostMicroUsd } from './limits';

const none = { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 };

test('an attempt costs its tokens at the Claude Haiku 5.5 list price, rounded up to a whole micro-dollar', () => {
  // $0.10 and $0.50 per million input and output tokens; cache reads 0.1x, cache writes 1.25x.
  expect(costMicroUsd({ ...none, inputTokens: 100_000 }, AI_MODEL_PRICE)).toBe(10_000);
  expect(costMicroUsd({ ...none, outputTokens: 1_000_000 }, AI_MODEL_PRICE)).toBe(500_000);
  expect(costMicroUsd({ ...none, cacheReadTokens: 100_000 }, AI_MODEL_PRICE)).toBe(1_000);
  expect(costMicroUsd({ ...none, cacheWriteTokens: 100_000 }, AI_MODEL_PRICE)).toBe(12_500);
  expect(costMicroUsd({ ...none, outputTokens: 1 }, AI_MODEL_PRICE)).toBe(1);
  expect(costMicroUsd(none, AI_MODEL_PRICE)).toBe(0);
});

test('a prompt over 100K tokens is priced at five times every rate', () => {
  expect(costMicroUsd({ ...none, inputTokens: 60_000, cacheReadTokens: 40_000 }, AI_MODEL_PRICE)).toBe(6_400);
  expect(costMicroUsd({ ...none, inputTokens: 100_001, outputTokens: 1_000 }, AI_MODEL_PRICE)).toBe(52_501);
});

test('the reservation covers every step and attempt of a turn at its caps', () => {
  const limits = AI_TURN_LIMITS.chat;
  const dearestAttempt = costMicroUsd(
    { ...none, cacheWriteTokens: limits.maxInputTokens, outputTokens: limits.maxOutputTokens },
    AI_MODEL_PRICE,
  );
  expect(maxTurnCostMicroUsd('chat')).toBe(limits.maxSteps * (limits.maxRetries + 1) * dearestAttempt);
  // The input cap keeps every prompt on the lower price card.
  expect(limits.maxInputTokens).toBeLessThan(AI_MODEL_PRICE.longPromptTokens);
});

test('the input estimate counts one token per two UTF-8 bytes, so umlauts count more', () => {
  expect(estimateInputTokens('abcd')).toBe(2);
  expect(estimateInputTokens('äöü')).toBe(3);
  expect(estimateInputTokens('')).toBe(0);
});

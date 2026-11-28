import { expect, test } from 'bun:test';

import { AI_MODEL_PRICE, costMicroUsd } from './cost';
import {
  AI_EXTRACT_LIMITS,
  AI_TURN_LIMITS,
  inputTokenCeiling,
  maxExtractionCostMicroUsd,
  maxTurnCostMicroUsd,
} from './limits';

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

test('the reservation covers every step and every retry of a turn, and every extraction its tools may run, at their caps', () => {
  const limits = AI_TURN_LIMITS.chat;
  const dearestAttempt = costMicroUsd(
    { ...none, cacheWriteTokens: limits.maxInputTokens, outputTokens: limits.maxOutputTokens },
    AI_MODEL_PRICE,
  );
  const extraction = costMicroUsd(
    {
      ...none,
      inputTokens: AI_EXTRACT_LIMITS.maxInputTokens,
      outputTokens: AI_EXTRACT_LIMITS.maxOutputTokens,
    },
    AI_MODEL_PRICE,
  );
  expect(maxExtractionCostMicroUsd()).toBe(extraction);
  expect(maxTurnCostMicroUsd('chat')).toBe(
    (limits.maxSteps + limits.maxRetries) * dearestAttempt + limits.maxToolModelCalls * extraction,
  );
  // The input caps keep every prompt on the lower price card.
  expect(limits.maxInputTokens).toBeLessThan(AI_MODEL_PRICE.longPromptTokens);
  expect(AI_EXTRACT_LIMITS.maxInputTokens).toBeLessThan(AI_MODEL_PRICE.longPromptTokens);
});

test('the input ceiling counts one token per UTF-8 byte, so umlauts count double', () => {
  expect(inputTokenCeiling('abcd')).toBe(4);
  expect(inputTokenCeiling('äöü')).toBe(6);
  expect(inputTokenCeiling('')).toBe(0);
});

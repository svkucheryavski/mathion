import { describe, it, expect } from 'vitest';
import {
  TYPE_LABEL, formatNumber, decimalsText, toleranceText, cutName, questionHints, sameNumber,
} from './quizFormat';
import type { AuthoringOption } from './quizAuthoring';

const opt = (id: number, is_correct: boolean): AuthoringOption =>
  ({ id, question_id: 1, text: `A${id}`, is_correct, order: id });

describe('quizFormat', () => {
  it('chip labels (and the picker) use the four sans names', () => {
    expect(Object.values(TYPE_LABEL)).toEqual(['Single choice', 'Multiple choice', 'Number', 'Text']);
  });

  it('formatNumber never uses exponent notation', () => {
    expect(formatNumber(1e-7)).toBe('0.0000001');
    expect(formatNumber(5)).toBe('5');
    expect(formatNumber(1234567890.12345)).toBe('1234567890.12345');
    expect(formatNumber(-0.25)).toBe('-0.25');
    expect(formatNumber(-0)).toBe('0');
  });

  it('decimals read "1 decimal" and "N decimals"', () => {
    expect(decimalsText(0)).toBe('0 decimals');
    expect(decimalsText(1)).toBe('1 decimal');
    expect(decimalsText(2)).toBe('2 decimals');
  });

  it('the tolerance prints with decimals + 1 places, never as 5e-7', () => {
    expect(toleranceText(0)).toBe('± 0.5');
    expect(toleranceText(2)).toBe('± 0.005');
    expect(toleranceText(6)).toBe('± 0.0000005');
    expect(toleranceText(10)).toBe('± 0.00000000005');
  });

  it('cutName keeps 40 characters and adds an ellipsis', () => {
    expect(cutName('x'.repeat(40))).toBe('x'.repeat(40));
    expect(cutName('y'.repeat(41))).toBe(`${'y'.repeat(40)}…`);
    expect(cutName('  padded  ')).toBe('padded');
  });

  it('hints wait for the answers to load', () => {
    expect(questionHints('single_choice', null, null)).toEqual([]);
  });

  it('hints for choice questions', () => {
    expect(questionHints('single_choice', [], null)).toEqual(['No answers yet']);
    expect(questionHints('single_choice', [opt(1, true)], null)).toEqual(['Add at least 2 answers']);
    expect(questionHints('multiple_choice', [opt(1, false), opt(2, false)], null)).toEqual(['No correct answer']);
    expect(questionHints('single_choice', [opt(1, true), opt(2, true)], null)).toEqual(['More than one correct']);
    expect(questionHints('multiple_choice', [opt(1, true), opt(2, true)], null)).toEqual([]);
  });

  it('hints for Number and Text', () => {
    expect(questionHints('numeric_answer', null, null)).toEqual(['Decimals not set']);
    expect(questionHints('numeric_answer', null, 2)).toEqual([]);
    expect(questionHints('text_answer', null, null)).toEqual([]);
  });

  it('sameNumber compares canonical forms', () => {
    expect(sameNumber('5.0', 5)).toBe(true);
    expect(sameNumber('5.1', 5)).toBe(false);
    expect(sameNumber('0.0000001', 1e-7)).toBe(true);
    expect(sameNumber('', null)).toBe(true);
    expect(sameNumber('4', null)).toBe(false);
    expect(sameNumber('abc', 5)).toBe(false);
  });
});

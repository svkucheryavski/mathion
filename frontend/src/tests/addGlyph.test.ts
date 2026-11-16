import { it, expect } from 'vitest';
import versionEdit from '../pages/editor/VersionEditPage.svelte?raw';
import versions from '../pages/editor/VersionsPage.svelte?raw';
import block from '../components/editor/BlockAccordion.svelte?raw';
import sequence from '../components/editor/SequenceAccordion.svelte?raw';
import quizBody from '../components/editor/quiz/QuizBody.svelte?raw';
import choices from '../components/editor/quiz/ChoiceAnswers.svelte?raw';
import card from '../components/editor/quiz/QuestionCard.svelte?raw';
import assets from '../components/runs/RunAssetsTab.svelte?raw';

// The "+" is drawn, not read: a screen reader hears "Add block", not "plus Add block".
it.each([
  ['VersionEditPage', 'Add block', versionEdit],
  ['VersionsPage', 'Add version', versions],
  ['BlockAccordion', 'Add sequence', block],
  ['SequenceAccordion', 'Add item', sequence],
  ['QuizBody', 'Add question', quizBody],
  ['ChoiceAnswers', 'Add answer', choices],
  ['QuestionCard', 'Add explanation', card],
  ['RunAssetsTab', 'Upload', assets],
])('%s hides the "+" of "%s"', (_name, label, src) => {
  expect(src).toContain(`<span aria-hidden="true">+</span> ${label}<`);
  expect(src).not.toMatch(new RegExp(`>\\+ ${label}<`));
});

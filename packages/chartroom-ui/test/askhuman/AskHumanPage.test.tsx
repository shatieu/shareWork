import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AskHumanAnswerPayload, AskHumanSpecQuestion } from '../../src/api/inboxClient.js';

const specMock = vi.fn<
  (cwd: string, session: string) => Promise<{ cwd: string; sessionId: string; questions: AskHumanSpecQuestion[] }>
>();
const submitMock = vi.fn<
  (cwd: string, session: string, answers: AskHumanAnswerPayload[]) => Promise<{ ok: true; path: string }>
>();

vi.mock('../../src/api/inboxClient.js', async () => {
  const real = await vi.importActual<typeof import('../../src/api/inboxClient.js')>('../../src/api/inboxClient.js');
  return {
    ...real,
    fetchAskHumanSpec: (...args: unknown[]) => specMock(...(args as [string, string])),
    submitAskHumanAnswers: (...args: unknown[]) => submitMock(...(args as [string, string, AskHumanAnswerPayload[]])),
  };
});

const { AskHumanPage } = await import('../../src/askhuman/AskHumanPage.js');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** One question of several types -- the multi-type render + byte-shaped submit acceptance. */
const SPEC: AskHumanSpecQuestion[] = [
  {
    id: 'auth-strategy',
    type: 'single-select',
    prompt: 'Which auth strategy?',
    context: 'Current middleware uses cookies.',
    choices: [
      { value: 'jwt-cookie', label: 'JWT in an httpOnly cookie' },
      { value: 'session', label: 'Server-side sessions' },
    ],
  },
  { id: 'notes', type: 'text', prompt: 'Anything else?', suggested: 'looks good' },
  { id: 'happy', type: 'yesno', prompt: 'Happy with the plan?' },
  {
    id: 'priorities',
    type: 'ranking',
    prompt: 'Rank these',
    choices: [
      { value: 'perf', label: 'Performance' },
      { value: 'dx', label: 'DX' },
      { value: 'cost', label: 'Cost' },
    ],
  },
  { id: 'confidence', type: 'rating', prompt: 'How confident?', min: 1, max: 10, suggested: 8 },
];

function renderPage(): void {
  specMock.mockResolvedValue({ cwd: 'C:/repos/proj', sessionId: 'auth-strategy', questions: SPEC });
  render(<AskHumanPage cwd="C:/repos/proj" sessionId="auth-strategy" />);
}

describe('AskHumanPage (wave2-E item 4)', () => {
  it('renders a multi-type spec with the ship question widgets, context included', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Questions from auth-strategy' })).toBeInTheDocument();
    // single-select renders radios, context is shown.
    expect(screen.getByText('Current middleware uses cookies.')).toBeInTheDocument();
    expect(screen.getByLabelText?.('JWT in an httpOnly cookie') ?? screen.getByText('JWT in an httpOnly cookie')).toBeInTheDocument();
    // text renders the suggested pre-fill.
    expect(screen.getByDisplayValue('looks good')).toBeInTheDocument();
    // yesno renders its three buttons.
    expect(screen.getByRole('button', { name: 'Yes' })).toBeInTheDocument();
    // ranking renders the choices in order; rating renders a slider-style input.
    expect(screen.getByText('Performance')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'How confident?' })).toBeInTheDocument();
  });

  it('submit stays disabled until every question validates, then posts answers in spec order', async () => {
    renderPage();
    const submit = await screen.findByRole('button', { name: 'Submit all answers' });
    expect(submit).toBeDisabled(); // single-select + yesno unanswered

    fireEvent.click(screen.getByText('JWT in an httpOnly cookie'));
    expect(submit).toBeDisabled(); // yesno still unanswered
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    expect(submit).toBeEnabled();

    submitMock.mockResolvedValue({
      ok: true,
      path: 'C:/repos/proj/.claude/ask-human/sessions/auth-strategy/answers.json',
    });
    fireEvent.click(submit);

    await waitFor(() =>
      expect(submitMock).toHaveBeenCalledWith('C:/repos/proj', 'auth-strategy', [
        { id: 'auth-strategy', type: 'single-select', value: 'jwt-cookie' },
        { id: 'notes', type: 'text', value: 'looks good' },
        { id: 'happy', type: 'yesno', value: 'yes' },
        { id: 'priorities', type: 'ranking', value: ['perf', 'dx', 'cost'] },
        { id: 'confidence', type: 'rating', value: 8 },
      ]),
    );
    // Success pane names the written answers.json and hands off to the session.
    expect(await screen.findByRole('status')).toHaveTextContent(/answers\.json/);
    expect(screen.getByText('back to inbox')).toHaveAttribute('href', '#/inbox');
  });

  it('a submit failure surfaces and the form stays editable', async () => {
    renderPage();
    await screen.findByRole('button', { name: 'Submit all answers' });
    fireEvent.click(screen.getByText('JWT in an httpOnly cookie'));
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));

    submitMock.mockRejectedValue(new Error('no valid spec.json for that session'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit all answers' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/no valid spec\.json/);
    expect(screen.getByRole('button', { name: 'Submit all answers' })).toBeEnabled();
  });

  it('a spec fetch failure renders the error, not a blank page', async () => {
    specMock.mockRejectedValue(new Error('no valid spec.json for that session'));
    render(<AskHumanPage cwd="C:/repos/proj" sessionId="ghost" />);
    expect(await screen.findByText(/no valid spec\.json/)).toBeInTheDocument();
  });
});

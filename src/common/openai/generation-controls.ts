export type OpenAiGenerationControls =
  | { reasoning_effort: 'none' | 'low' }
  | { temperature: number };

/**
 * Sampling controls for a Chat Completions request, by model family.
 *
 * GPT-5/6 reasoning models reject sampling controls such as temperature, so
 * they get the lightest reasoning effort they accept instead:
 * - Sol and Astra (gpt-6-sol, gpt-6.1-sol, gpt-6.2-sol, gpt-6.2-astra…) do not
 *   accept `none`; `low` is their floor.
 * - Every other GPT-5/6 model (gpt-5.6-terra, gpt-6.1-terra, gpt-6-luna…)
 *   accepts `none`.
 * Older and OpenAI-compatible chat models keep the caller's temperature.
 */
export function openAiGenerationControls(
  model: string,
  temperature: number,
): OpenAiGenerationControls {
  if (/^gpt-6(?:\.\d+)?-(?:sol|astra)(?:-|$)/.test(model))
    return { reasoning_effort: 'low' };
  if (/^gpt-[56](?:[.-]|$)/.test(model)) return { reasoning_effort: 'none' };
  return { temperature };
}

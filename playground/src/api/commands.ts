import { queryCatalog, type CatalogFilter } from './catalog';
import { compileRecipe, recipeKeys, recipeObject } from './recipe';
import { validateDocument } from '../io/document';
import { solveCircuit } from '../solver/solve';
import { sweepCircuit } from '../solver/sweep';
import { parseNotebook } from '../experiments/notebook';
import { compareExperiments } from '../experiments/compare';
import { runGoalSearch, validateGoalRequest } from '../experiments/goals';
import type { CircuitDocument } from '../model/types';

function documentInput(input: Record<string, unknown>): CircuitDocument {
  if (Object.hasOwn(input, 'recipe') === Object.hasOwn(input, 'document')) throw new Error('Provide exactly one recipe or document.');
  if (Object.hasOwn(input, 'recipe')) return compileRecipe(input.recipe);
  validateDocument(input.document);
  return structuredClone(input.document);
}

/** JSON command protocol used by the Node CLI; no ambient document or hidden state. */
export async function executeCommand(input: unknown): Promise<unknown> {
  const command = recipeObject(input, 'command');
  switch (command.command) {
    case 'catalog':
      recipeKeys(command, ['command'], ['filter'], 'command');
      return queryCatalog(command.filter as CatalogFilter | undefined);
    case 'compile':
      recipeKeys(command, ['command', 'recipe'], [], 'command');
      return compileRecipe(command.recipe);
    case 'solve':
      recipeKeys(command, ['command'], ['recipe', 'document'], 'command');
      return solveCircuit(documentInput(command).circuit);
    case 'sweep': {
      recipeKeys(command, ['command', 'startM', 'stopM', 'points'], ['recipe', 'document'], 'command');
      const document = documentInput(command);
      const request = { id: 0, circuit: document.circuit, startM: command.startM as number, stopM: command.stopM as number, points: command.points as number };
      return { request, ...await sweepCircuit(request) };
    }
    case 'compare': {
      recipeKeys(command, ['command', 'notebook'], ['variantIds'], 'command');
      const notebook = parseNotebook(JSON.stringify(command.notebook));
      if (command.variantIds !== undefined && (!Array.isArray(command.variantIds) || command.variantIds.some(id => typeof id !== 'string'))) throw new Error('variantIds must be an array of strings.');
      return compareExperiments({ id: 0, notebook, variantIds: command.variantIds as string[] | undefined });
    }
    case 'search':
      recipeKeys(command, ['command', 'request'], [], 'command');
      validateGoalRequest(command.request);
      return runGoalSearch(command.request);
    default: throw new Error('Unknown command. Expected catalog, compile, solve, sweep, compare or search.');
  }
}

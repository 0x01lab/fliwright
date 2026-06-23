import { startVitest } from 'vitest/node';

const root = new URL('./fixture-project/vitest.config.ts', import.meta.url).pathname;
const file = new URL('./fixture-project/.fliwright/tests/sample.test.ts', import.meta.url).pathname;

function makeCollector() {
  const runs = [];
  const reporter = {
    onFinished(files) {
      runs.push(files.flatMap((f) => f.tasks.flatMap((suite) => suite.tasks ?? [])
        .filter((task) => task.type === 'test')
        .map((task) => ({ name: task.name, state: task.result?.state }))));
    },
  };
  return { reporter, runs };
}

async function tryRecipe(label, fn) {
  const { reporter, runs } = makeCollector();
  const v = await startVitest('test', [], { config: root, watch: true, reporters: [reporter] });
  try {
    await fn(v);
    console.log(`[${label}] runs:`, JSON.stringify(runs));
  } catch (error) {
    console.log(`[${label}] THREW:`, error instanceof Error ? error.message : String(error));
  } finally {
    await v?.close();
  }
}

await tryRecipe('A: changeNamePattern only', async (v) => {
  await v.changeNamePattern('alpha passes', [file], 'probe');
});

await tryRecipe('B: configOverride testNamePattern+rerunFiles', async (v) => {
  v.configOverride = { ...v.configOverride, testNamePattern: /alpha passes/ };
  await v.rerunFiles([file], 'probe', false);
});

await tryRecipe('C: rerunFiles only (control)', async (v) => {
  await v.rerunFiles([file], 'probe', false);
});

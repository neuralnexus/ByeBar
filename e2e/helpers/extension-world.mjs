export async function evaluateInExtensionWorld(page, expression) {
  const session = await page.context().newCDPSession(page);
  const contexts = [];
  session.on('Runtime.executionContextCreated', ({ context }) => contexts.push(context));
  await session.send('Runtime.enable');
  const { frameTree } = await session.send('Page.getFrameTree');
  await page.waitForTimeout(50);

  for (const context of contexts) {
    if (context.auxData?.frameId !== frameTree.frame.id || context.auxData?.isDefault) continue;
    const probe = await session.send('Runtime.evaluate', {
      contextId: context.id,
      expression: 'Boolean(globalThis.ByeBar?.engine)',
      returnByValue: true
    });
    if (!probe.result.value) continue;
    const result = await session.send('Runtime.evaluate', {
      contextId: context.id,
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    await session.detach();
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  }

  await session.detach();
  throw new Error('ByeBar isolated world not found');
}

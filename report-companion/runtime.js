export async function startLoopbackCompanion({ server, pairingStore, port = 43_121, logger = console }) {
  if (!await pairingStore.isPaired()) {
    const code = await pairingStore.getPairingCode();
    logger.log(`today i found pairing code: ${code}`);
  }
  await new Promise((resolve, reject) => {
    server.once?.("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  logger.log(`today i found report companion listening on http://127.0.0.1:${server.address().port}`);
  return server;
}

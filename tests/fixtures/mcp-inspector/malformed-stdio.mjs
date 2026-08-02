process.stdin.once("data", () => {
  process.stdout.write('{"jsonrpc":"2.0","id":');
});
setInterval(() => undefined, 1_000);

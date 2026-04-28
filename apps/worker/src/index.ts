async function main() {
  console.log('worker started');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

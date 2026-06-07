export const waitFor = async (assertion, timeout = 10000, interval = 100) => {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    try {
      return await assertion();
    } catch {
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }

  return assertion();
};

function createCloseGate() {
  let approved = false;
  return {
    shouldIntercept() {
      if (!approved) return true;
      approved = false;
      return false;
    },
    approveOnce() { approved = true; },
  };
}

module.exports = { createCloseGate };

const path = require("path");

module.exports = {
  webpack: {
    alias: {
      "@": path.resolve(__dirname, "src")
    }
  },
  // Mirror the webpack alias so tests can import modules that use "@/..."
  // internally; without it any such module is untestable.
  jest: {
    configure: {
      moduleNameMapper: {
        "^@/(.*)$": "<rootDir>/src/$1"
      }
    }
  }
};

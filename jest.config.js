// jest.config.js

module.exports = {
  preset: "react-native",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
  
  transform: {
    "^.+\\.(js|jsx|ts|tsx)$": "babel-jest",
  },
  
  transformIgnorePatterns: [
    "node_modules/(?!(react-native|@react-native|@react-navigation|@react-native-async-storage|@react-native-cookies|axios|react-native-.*|nativewind|react-native-reanimated)/)",
  ],
  
  moduleNameMapper: {
    "\\.(jpg|jpeg|png|gif|webp|svg)$": "<rootDir>/__mocks__/fileMock.js",
  },
   moduleNameMapper: {
    "^@react-navigation/native$": "<rootDir>/__mocks__/react-navigation-native.js",
    "\\.(jpg|jpeg|png|gif|webp|svg)$": "<rootDir>/__mocks__/fileMock.js",
  },
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
};


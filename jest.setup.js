// jest.setup.js

import "@testing-library/jest-native/extend-expect";

// Mock AsyncStorage
jest.mock(
  "@react-native-async-storage/async-storage",
  () => require("@react-native-async-storage/async-storage/jest/async-storage-mock")
);

// Mock Reanimated
jest.mock("react-native-reanimated", () => {
  const Reanimated = require("react-native-reanimated/mock");
  Reanimated.default.call = () => {};
  return Reanimated;
});

// Mock NativeWind
jest.mock("nativewind", () => ({
  styled: (component) => component,
}));
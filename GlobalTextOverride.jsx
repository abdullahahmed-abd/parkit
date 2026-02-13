import { Text as RNText, StyleSheet } from "react-native";
import React from "react";

const defaultRender = RNText.render;

RNText.render = function (...args) {
  const origin = defaultRender.apply(this, args);

  let fontFamily = "Poppins-Regular"; // default

  // Check if style contains fontWeight
  const weight = origin.props.style?.fontWeight || "400";

  switch (String(weight)) {
  case "700":
  case "bold":
    fontFamily = "Poppins-Bold";
    break;
  case "600":
    fontFamily = "Poppins-SemiBold";
    break;
  case "500":
    fontFamily = "Poppins-Medium";
    break;
  case "300":
    fontFamily = "Poppins-Light";
    break;
  default:
    fontFamily = "Poppins-Regular";
}


  return React.cloneElement(origin, {
    style: [origin.props.style, { fontFamily }],
  });
};

import React, { memo } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Platform } from "react-native";
import { scale, moderateScale, verticalScale } from "react-native-size-matters";
import { RFValue } from "react-native-responsive-fontsize";

import { HugeiconsIcon } from "@hugeicons/react-native";

// ✅ Icons: (Agar kisi ka name mismatch ho to mujhe error bhej do)
import {
  Activity01Icon,        // Explore (placeholder)
  SparklesIcon,          // Saved (placeholder)
  ArrowRight01Icon,      // Contribute (placeholder)
  Logout02Icon,          // More/Profile (placeholder)
  CheckmarkCircle03Icon, // Center add (placeholder)
} from "@hugeicons/core-free-icons";

const s = (v) => scale(v);
const ms = (v) => moderateScale(v, 0.3);
const vs = (v) => verticalScale(v);
const rf = (v) => RFValue(v);

const COLORS = {
  primary: "#E53935",
  textPrimary: "#212121",
  textHint: "#9E9E9E",
  white: "#FFFFFF",
  divider: "#EEEEEE",
  shadow: "#000000",
};

const TABS = [
  { key: "Explore", label: "Explore", icon: Activity01Icon },
  { key: "Saved", label: "Save", icon: SparklesIcon },
  { key: "Add", label: "", icon: CheckmarkCircle03Icon, center: true },
  { key: "Contribute", label: "Contribute", icon: ArrowRight01Icon },
  { key: "More", label: "More", icon: Logout02Icon },
];

function BottomNavBar({ activeKey = "Explore", onTabPress, insets }) {
  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.wrap,
        { paddingBottom: Math.max(insets?.bottom || 0, vs(10)) },
      ]}
    >
      <View style={styles.bar}>
        {TABS.map((t) => {
          if (t.center) {
            return (
              <TouchableOpacity
                key={t.key}
                activeOpacity={0.9}
                onPress={() => onTabPress?.(t.key)}
                style={styles.centerBtnWrap}
              >
                <View style={styles.centerBtn}>
                  <HugeiconsIcon
                    icon={t.icon}
                    size={ms(22)}
                    color={COLORS.primary}
                    strokeWidth={2.2}
                  />
                </View>
              </TouchableOpacity>
            );
          }

          const active = activeKey === t.key;

          return (
            <TouchableOpacity
              key={t.key}
              activeOpacity={0.8}
              onPress={() => onTabPress?.(t.key)}
              style={styles.tab}
            >
              <HugeiconsIcon
                icon={t.icon}
                size={ms(22)}
                color={active ? COLORS.primary : COLORS.textHint}
                strokeWidth={2.2}
              />
              <Text style={[styles.label, active && styles.labelActive]}>
                {t.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

export default memo(BottomNavBar);

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: s(14),
    right: s(14),
    bottom: 0,
    zIndex: 50,
  },

  // ✅ iPhone style rounded floating bar (image jaisa)
  bar: {
    height: ms(64),
    backgroundColor: COLORS.white,
    borderRadius: ms(22),
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: s(10),
    borderWidth: 1,
    borderColor: COLORS.divider,

    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.10,
    shadowRadius: 18,
    elevation: 10,
  },

  tab: {
    flex: 1,
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },

  label: {
    marginTop: vs(3),
    fontSize: rf(9.5),
    color: COLORS.textHint,
    fontWeight: Platform.OS === "ios" ? "600" : "700",
  },
  labelActive: {
    color: COLORS.primary,
  },

  // ✅ Center “+” style raised button
  centerBtnWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  centerBtn: {
    width: ms(44),
    height: ms(44),
    borderRadius: ms(22),
    backgroundColor: COLORS.white,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: COLORS.divider,

    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 14,
    elevation: 8,

    // little lift (floating feel)
    marginTop: vs(-16),
  },
});
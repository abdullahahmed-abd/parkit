# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Add any project specific keep options here:

# Please add these rules to your existing keep rules in order to suppress warnings.
# This is generated automatically by the Android Gradle plugin.
-dontwarn com.gemalto.jp2.JP2Decoder

# ═══════════════════════════════════════════════════════════════
# 🌐 NETWORKING — Release APK me API calls work kare
# ═══════════════════════════════════════════════════════════════

# OkHttp (React Native internally uses this)
-keep class okhttp3.** { *; }
-keep interface okhttp3.** { *; }
-dontwarn okhttp3.**
-dontwarn okio.**
-keep class okio.** { *; }

# Java networking classes
-keep class java.net.** { *; }
-keep class javax.net.** { *; }
-keep class javax.net.ssl.** { *; }
-keep class android.net.** { *; }

# SSL / TLS
-keep class com.android.org.conscrypt.** { *; }
-dontwarn com.android.org.conscrypt.**
-keep class org.conscrypt.** { *; }
-dontwarn org.conscrypt.**

# ═══════════════════════════════════════════════════════════════
# 📱 REACT NATIVE
# ═══════════════════════════════════════════════════════════════

-keep class com.facebook.react.** { *; }
-keep class com.facebook.hermes.** { *; }
-keep class com.facebook.jni.** { *; }
-dontwarn com.facebook.react.**

# React Native Networking Module
-keep class com.facebook.react.modules.network.** { *; }

# ═══════════════════════════════════════════════════════════════
# 🗺️ MAPLIBRE
# ═══════════════════════════════════════════════════════════════

-keep class org.maplibre.** { *; }
-keep class com.mapbox.** { *; }
-dontwarn org.maplibre.**
-dontwarn com.mapbox.**

# ═══════════════════════════════════════════════════════════════
# 🔵 BLUETOOTH
# ═══════════════════════════════════════════════════════════════

-keep class com.parkit.newapp.bluetooth.** { *; }
-keep class com.parkit.newapp.BluetoothModule { *; }

# ═══════════════════════════════════════════════════════════════
# 🔧 GENERAL
# ═══════════════════════════════════════════════════════════════

# JSON parsing
-keepattributes Signature
-keepattributes *Annotation*
-keep class com.google.gson.** { *; }
-dontwarn com.google.gson.**

# Keep native methods
-keepclasseswithmembernames class * {
    native <methods>;
}

# Keep enums
-keepclassmembers enum * {
    public static **[] values();
    public static ** valueOf(java.lang.String);
}
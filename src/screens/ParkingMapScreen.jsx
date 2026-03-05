import React, {useMemo, useRef, useState} from 'react';
import {View, Text, StyleSheet, TextInput, TouchableOpacity, Platform} from 'react-native';
import {WebView} from 'react-native-webview';
import {SafeAreaView, useSafeAreaInsets} from 'react-native-safe-area-context';

function BoxIcon({size = 22}) {
  return <View style={[styles.iconBox, {width: size, height: size}]} />;
}

export default function ParkingMapDesignNoApi() {
  const insets = useSafeAreaInsets();
  const webRef = useRef(null);

  const [activeMode, setActiveMode] = useState(null); // 'occupy' | 'vacate'
  const [selectedTab, setSelectedTab] = useState('Explore');

  // Same feel (Düsseldorf area). Change if you want.
  const center = useMemo(() => ({lat: 51.2387, lng: 6.7892, zoom: 16}), []);
  const user = useMemo(() => ({lat: 51.2358, lng: 6.7815}), []);

  const html = useMemo(() => {
    return `<!doctype html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    html, body { height:100%; margin:0; padding:0; background:#f3e9d8; }
    #map { height:100%; width:100%; }

    /* Make map look clean like screenshot */
    .leaflet-control-attribution { display:none !important; }
    .leaflet-container { background:#f3e9d8; }

    /* User marker (yellow ring) */
    .user-marker {
      width:18px; height:18px;
      border-radius:9px;
      background:#F6C600;
      border:3px solid #fff;
      box-sizing:border-box;
      box-shadow: 0 4px 14px rgba(0,0,0,0.18);
      display:flex; align-items:center; justify-content:center;
    }
    .user-marker-inner {
      width:6px; height:6px;
      border-radius:3px;
      background:#ffffff;
    }
  </style>
</head>
<body>
  <div id="map"></div>

  <script>
    var map = L.map('map', {
      zoomControl: false,
      attributionControl: false
    }).setView([${center.lat}, ${center.lng}], ${center.zoom});

    // ✅ SAME outdoor colors (OSM Standard tiles)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      subdomains: ['a','b','c'],
      detectRetina: true
    }).addTo(map);

    // User marker
    var userIcon = L.divIcon({
      className: '',
      html: '<div class="user-marker"><div class="user-marker-inner"></div></div>',
      iconSize: [18,18],
      iconAnchor: [9,9]
    });
    L.marker([${user.lat}, ${user.lng}], {icon: userIcon}).addTo(map);

    // called from RN locate button
    window.__goToUser = function() {
      map.setView([${user.lat}, ${user.lng}], 17, {animate:true});
    };
  </script>
</body>
</html>`;
  }, [center, user]);

  const onLocate = () => {
    webRef.current?.injectJavaScript(`window.__goToUser && window.__goToUser(); true;`);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        {/* Outdoor map (NO API) */}
        <WebView
          ref={webRef}
          source={{html}}
          style={StyleSheet.absoluteFill}
          javaScriptEnabled
          domStorageEnabled
          originWhitelist={['*']}
        />

        {/* Search bar */}
        <View style={[styles.searchWrap, {top: insets.top + 8}]}>
          <BoxIcon size={22} />
          <TextInput
            placeholder="Search here"
            placeholderTextColor="#9A9A9A"
            style={styles.searchInput}
          />
          <BoxIcon size={22} />
        </View>

        {/* Occupy / Vacate */}
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={() => setActiveMode('occupy')}
          style={[
            styles.pillBtn,
            styles.pillLeft,
            {top: insets.top + 70},
            activeMode === 'occupy' && styles.pillActive,
          ]}
        >
          <Text style={[styles.pillText, activeMode === 'occupy' && styles.pillTextActive]}>
            Occupy Spot
          </Text>
          <BoxIcon size={18} />
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.9}
          onPress={() => setActiveMode('vacate')}
          style={[
            styles.pillBtn,
            styles.pillRight,
            {top: insets.top + 70},
            activeMode === 'vacate' && styles.pillActive,
          ]}
        >
          <Text style={[styles.pillText, activeMode === 'vacate' && styles.pillTextActive]}>
            Vacate Spot
          </Text>
          <BoxIcon size={18} />
        </TouchableOpacity>

        {/* Locate button */}
        <TouchableOpacity
          activeOpacity={0.9}
          style={[styles.locateBtn, {bottom: 140 + insets.bottom}]}
          onPress={onLocate}
        >
          <View style={styles.locateDot} />
        </TouchableOpacity>

        {/* Find Parking */}
        <View style={[styles.findWrap, {bottom: 74 + insets.bottom}]}>
          <TouchableOpacity activeOpacity={0.9} style={styles.findBtn}>
            <View style={styles.findIconBox} />
            <Text style={styles.findText}>Find Parking</Text>
          </TouchableOpacity>
        </View>

        {/* Bottom tabs */}
        <View style={[styles.tabBar, {paddingBottom: 10 + insets.bottom}]}>
          {['Explore', 'Save', 'Contribute', 'More'].map(key => {
            const active = selectedTab === key;
            return (
              <TouchableOpacity
                key={key}
                style={styles.tabItem}
                onPress={() => setSelectedTab(key)}
                activeOpacity={0.85}
              >
                <View
                  style={[
                    styles.tabIconBox,
                    {borderColor: active ? '#E3423B' : '#1E1E1E'},
                  ]}
                />
                <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{key}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </SafeAreaView>
  );
}

const SHADOW = Platform.select({
  ios: {
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: {width: 0, height: 6},
  },
  android: {elevation: 6},
});

const styles = StyleSheet.create({
  safe: {flex: 1, backgroundColor: '#F3E9D8'},
  container: {flex: 1},

  searchWrap: {
    position: 'absolute',
    left: 16,
    right: 16,
    height: 46,
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    ...SHADOW,
  },
  searchInput: {
    flex: 1,
    marginHorizontal: 10,
    color: '#222',
    paddingVertical: 0,
  },

  iconBox: {
    borderRadius: 8,
    backgroundColor: '#EEE',
    borderWidth: 1,
    borderColor: '#DDD',
  },

  pillBtn: {
    position: 'absolute',
    height: 36,
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    ...SHADOW,
  },
  pillLeft: {left: 16},
  pillRight: {right: 16},
  pillText: {color: '#8A8A8A', fontSize: 13, fontWeight: '600'},

  // If you want active highlight later, change these colors
  pillActive: {backgroundColor: '#fff'},
  pillTextActive: {color: '#8A8A8A'},

  locateBtn: {
    position: 'absolute',
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    ...SHADOW,
  },
  locateDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#777',
  },

  findWrap: {
    position: 'absolute',
    left: 16,
    right: 16,
    alignItems: 'center',
  },
  findBtn: {
    width: '100%',
    height: 48,
    borderRadius: 14,
    backgroundColor: '#E56B65',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    ...SHADOW,
  },
  findIconBox: {
    width: 18,
    height: 18,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  findText: {color: '#fff', fontSize: 16, fontWeight: '700'},

  tabBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#fff',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingTop: 10,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.08,
        shadowRadius: 16,
        shadowOffset: {width: 0, height: -6},
      },
      android: {elevation: 12},
    }),
  },
  tabItem: {alignItems: 'center', width: 80},
  tabIconBox: {
    width: 22,
    height: 22,
    borderRadius: 8,
    borderWidth: 2,
  },
  tabLabel: {marginTop: 4, fontSize: 12, color: '#1E1E1E', fontWeight: '600'},
  tabLabelActive: {color: '#E3423B'},
});
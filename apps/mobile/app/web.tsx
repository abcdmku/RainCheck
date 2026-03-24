import { useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { WebView } from 'react-native-webview'

const defaultUrl = 'http://localhost:3000'

export default function WebShellScreen() {
  const [loading, setLoading] = useState(true)
  const url = useMemo(
    () => process.env.EXPO_PUBLIC_RAINCHECK_APP_URL ?? defaultUrl,
    [],
  )

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.chrome}>
        <View>
          <Text style={styles.label}>RainCheck</Text>
          <Text style={styles.caption}>{url}</Text>
        </View>
        <Pressable style={styles.badge}>
          <Text style={styles.badgeText}>Live</Text>
        </Pressable>
      </View>
      <View style={styles.webViewShell}>
        {loading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator color="#7ed7cb" />
            <Text style={styles.loadingText}>Connecting to local app…</Text>
          </View>
        ) : null}
        <WebView
          originWhitelist={['*']}
          source={{ uri: url }}
          onLoadEnd={() => setLoading(false)}
          style={styles.webView}
        />
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#071217',
  },
  chrome: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  label: {
    color: '#eef4f4',
    fontSize: 16,
    fontWeight: '700',
  },
  caption: {
    color: '#91a5a8',
    fontSize: 12,
    marginTop: 4,
  },
  badge: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#224149',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  badgeText: {
    color: '#b8d8d3',
    fontSize: 12,
    fontWeight: '600',
  },
  webViewShell: {
    flex: 1,
    borderTopWidth: 1,
    borderColor: '#12232a',
  },
  loadingState: {
    position: 'absolute',
    inset: 0,
    zIndex: 10,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: '#071217',
  },
  loadingText: {
    color: '#a6b8bb',
  },
  webView: {
    flex: 1,
    backgroundColor: '#071217',
  },
})

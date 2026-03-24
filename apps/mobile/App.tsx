import Constants from 'expo-constants'
import { StatusBar } from 'expo-status-bar'
import { useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { WebView } from 'react-native-webview'

const fallbackUrl = 'http://localhost:3000'

export default function App() {
  const [isLoading, setIsLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const appUrl = useMemo(() => {
    const extra = Constants.expoConfig?.extra as { appUrl?: string } | undefined
    return extra?.appUrl ?? fallbackUrl
  }, [])

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="light" />
        <View style={styles.header}>
          <Text style={styles.wordmark}>RainCheck</Text>
          <Text style={styles.subtle}>Mobile shell</Text>
        </View>

        {failed ? (
          <View style={styles.fallback}>
            <Text style={styles.fallbackTitle}>Web app unavailable</Text>
            <Text style={styles.fallbackCopy}>
              Start the local RainCheck web app, then reopen this screen.
            </Text>
            <Pressable
              style={styles.button}
              onPress={() => {
                void Linking.openURL(appUrl)
              }}
            >
              <Text style={styles.buttonLabel}>Open in browser</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <WebView
              source={{ uri: appUrl }}
              style={styles.webview}
              onLoadEnd={() => setIsLoading(false)}
              onError={() => {
                setFailed(true)
                setIsLoading(false)
              }}
            />
            {isLoading ? (
              <View style={styles.loadingOverlay}>
                <ActivityIndicator color="#7ce0d5" />
              </View>
            ) : null}
          </>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#081116',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 12,
    backgroundColor: '#0b151a',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#17313b',
  },
  wordmark: {
    color: '#eef5f5',
    fontSize: 18,
    fontWeight: '700',
  },
  subtle: {
    color: '#8da4a9',
    fontSize: 12,
  },
  webview: {
    flex: 1,
    backgroundColor: '#081116',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(8, 17, 22, 0.35)',
  },
  fallback: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
    gap: 12,
  },
  fallbackTitle: {
    color: '#eef5f5',
    fontSize: 20,
    fontWeight: '700',
  },
  fallbackCopy: {
    color: '#9eb2b6',
    textAlign: 'center',
    lineHeight: 21,
  },
  button: {
    marginTop: 8,
    paddingHorizontal: 18,
    paddingVertical: 12,
    backgroundColor: '#12303b',
    borderRadius: 999,
  },
  buttonLabel: {
    color: '#dce9ea',
    fontWeight: '600',
  },
})

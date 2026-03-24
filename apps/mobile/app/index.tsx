import { Link } from 'expo-router'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

export default function HomeScreen() {
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>RainCheck</Text>
          <Text style={styles.title}>Weather chat, wrapped for mobile.</Text>
          <Text style={styles.copy}>
            The primary product still lives in the conversation thread. This
            shell opens the same chat-first experience in a touch-friendly
            wrapper.
          </Text>
        </View>
        <Link href="/web" asChild>
          <Pressable style={styles.button}>
            <Text style={styles.buttonText}>Open RainCheck</Text>
          </Pressable>
        </Link>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#071217',
  },
  container: {
    flex: 1,
    paddingHorizontal: 24,
    paddingVertical: 28,
    justifyContent: 'space-between',
  },
  hero: {
    gap: 14,
    marginTop: 32,
  },
  eyebrow: {
    color: '#7ed7cb',
    fontSize: 12,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  title: {
    color: '#f3f7f7',
    fontSize: 32,
    fontWeight: '700',
    lineHeight: 40,
  },
  copy: {
    color: '#a6b8bb',
    fontSize: 16,
    lineHeight: 24,
  },
  button: {
    alignItems: 'center',
    borderRadius: 18,
    backgroundColor: '#dbe7e6',
    paddingVertical: 18,
  },
  buttonText: {
    color: '#081215',
    fontSize: 16,
    fontWeight: '700',
  },
})

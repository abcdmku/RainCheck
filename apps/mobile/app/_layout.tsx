import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: {
            backgroundColor: '#071217',
          },
          headerTintColor: '#eef4f4',
          contentStyle: {
            backgroundColor: '#071217',
          },
        }}
      />
    </>
  )
}

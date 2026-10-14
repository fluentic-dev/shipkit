import { shipkitEnv } from '@fluentic/shipkit/env';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';

export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Shipkit Expo Example</Text>
      <Text selectable style={styles.code}>
        {JSON.stringify(shipkitEnv, null, 2)}
      </Text>
      <StatusBar style='auto' />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: '#fff',
    gap: 16,
    justifyContent: 'center',
    padding: 24
  },
  code: {
    fontFamily: 'Courier',
    fontSize: 13,
    maxWidth: 420
  },
  title: {
    fontSize: 22,
    fontWeight: '700'
  }
});

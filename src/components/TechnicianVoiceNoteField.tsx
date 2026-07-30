import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';
import { WorkOrderEvidence } from '../types';
import { Button } from './UI';

const MAX_SECONDS = 120;
const WARNING_SECONDS = 105;
const VOICE_RECORDING_OPTIONS = {
  ...RecordingPresets.LOW_QUALITY,
  numberOfChannels: 1,
  bitRate: 64_000,
  web: {
    ...RecordingPresets.LOW_QUALITY.web,
    mimeType: 'audio/webm',
    bitsPerSecond: 64_000,
  },
};

type Props = {
  evidence?: WorkOrderEvidence;
  disabled?: boolean;
  uploading?: boolean;
  onUpload: (recording: { uri: string; durationSeconds: number; mimeType?: string }) => Promise<void>;
  onClear: () => void;
};

function formatTime(totalSeconds: number) {
  const safe = Math.max(0, Math.min(MAX_SECONDS, Math.floor(totalSeconds)));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

export function TechnicianVoiceNoteField({
  evidence,
  disabled = false,
  uploading = false,
  onUpload,
  onClear,
}: Props) {
  const recorder = useAudioRecorder(VOICE_RECORDING_OPTIONS);
  const recorderState = useAudioRecorderState(recorder, 250);
  const [recordedUri, setRecordedUri] = useState('');
  const [recordedSeconds, setRecordedSeconds] = useState(0);
  const [message, setMessage] = useState('Explica el trabajo realizado y tus recomendaciones. Máximo 2 minutos.');
  const [finalizing, setFinalizing] = useState(false);
  const finishingRef = useRef(false);
  const hadActiveRecordingRef = useRef(false);
  const playbackUri = recordedUri || evidence?.downloadUrl || '';
  const player = useAudioPlayer(playbackUri || null);
  const playerStatus = useAudioPlayerStatus(player);

  const elapsedSeconds = Math.min(MAX_SECONDS, Math.round(recorderState.durationMillis / 1000));
  const isRecording = recorderState.isRecording;

  useEffect(() => {
    if (isRecording) {
      hadActiveRecordingRef.current = true;
      return;
    }
    if (hadActiveRecordingRef.current && !finishingRef.current) {
      void finishRecording(true);
    }
  }, [isRecording]);

  async function startRecording() {
    if (disabled || uploading) return;
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      setMessage('Debes autorizar el micrófono para grabar la nota de voz.');
      return;
    }
    try {
      player.pause();
      setRecordedUri('');
      setRecordedSeconds(0);
      setMessage('Grabando. Tienes un máximo de 2 minutos.');
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync(VOICE_RECORDING_OPTIONS);
      recorder.record({ forDuration: MAX_SECONDS });
    } catch (error) {
      setMessage(`No se pudo iniciar la grabación: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function finishRecording(reachedLimit = false) {
    if (finishingRef.current) return;
    finishingRef.current = true;
    setFinalizing(true);
    try {
      if (recorder.isRecording) await recorder.stop();
      const uri = recorder.uri;
      const duration = Math.min(MAX_SECONDS, Math.max(1, Math.round(recorder.currentTime || elapsedSeconds)));
      if (!uri) throw new Error('El dispositivo no devolvió la grabación.');
      setRecordedUri(uri);
      setRecordedSeconds(duration);
      setMessage(reachedLimit || duration >= MAX_SECONDS
        ? 'La grabación llegó al máximo de 2 minutos y se detuvo automáticamente. Revísala antes de guardarla.'
        : 'Nota de voz lista. Puedes escucharla, repetirla o guardarla.');
    } catch (error) {
      setMessage(`No se pudo finalizar la grabación: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      hadActiveRecordingRef.current = false;
      finishingRef.current = false;
      setFinalizing(false);
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined);
    }
  }

  async function saveRecording() {
    if (!recordedUri || recordedSeconds > MAX_SECONDS) {
      setMessage('Tu nota de voz es muy larga. Tienes 2 minutos para dar el reporte. Vuélvelo a intentar.');
      return;
    }
    try {
      await onUpload({ uri: recordedUri, durationSeconds: recordedSeconds, mimeType: recordedUri.startsWith('blob:') ? 'audio/webm' : undefined });
      setRecordedUri('');
      setRecordedSeconds(0);
      setMessage('Nota de voz guardada en el reporte.');
    } catch (error) {
      setMessage(`No se pudo guardar la nota de voz: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function togglePlayback() {
    if (!playbackUri) return;
    if (playerStatus.playing) {
      player.pause();
      return;
    }
    if (playerStatus.didJustFinish || playerStatus.currentTime >= playerStatus.duration) await player.seekTo(0);
    player.play();
  }

  const displaySeconds = isRecording ? elapsedSeconds : recordedSeconds || evidence?.durationSeconds || 0;
  const approachingLimit = isRecording && elapsedSeconds >= WARNING_SECONDS;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.iconCircle}><Text style={styles.icon}>🎙</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Nota de voz del trabajo</Text>
          <Text style={styles.help}>Alternativa al resumen escrito · máximo 2:00</Text>
        </View>
        <Text style={[styles.timer, approachingLimit && styles.timerWarning]}>{formatTime(displaySeconds)} / 2:00</Text>
      </View>

      {approachingLimit ? (
        <View style={styles.warningBox}>
          <Text style={styles.warningText}>Te quedan {Math.max(0, MAX_SECONDS - elapsedSeconds)} segundos. La grabación se detendrá automáticamente.</Text>
        </View>
      ) : null}

      <Text style={styles.message}>{uploading ? 'Subiendo la nota de voz en segundo plano…' : message}</Text>

      <View style={styles.actions}>
        {isRecording ? (
          <Button compact variant="secondary" label={finalizing ? 'Finalizando…' : 'Detener grabación'} disabled={finalizing} onPress={() => void finishRecording()} />
        ) : (
          <Button compact label={recordedUri || evidence ? 'Grabar otra nota' : 'Grabar nota de voz'} disabled={disabled || uploading || finalizing} onPress={() => void startRecording()} />
        )}
        {playbackUri && !isRecording ? (
          <Pressable disabled={uploading} onPress={() => void togglePlayback()} style={styles.playButton}>
            <Text style={styles.playText}>{playerStatus.playing ? 'Pausar' : 'Escuchar'}</Text>
          </Pressable>
        ) : null}
        {recordedUri && !isRecording ? (
          <>
            <Button compact variant="success" label={uploading ? 'Subiendo…' : 'Guardar nota'} disabled={uploading} onPress={() => void saveRecording()} />
            <Button compact variant="ghost" label="Descartar" disabled={uploading} onPress={() => { setRecordedUri(''); setRecordedSeconds(0); }} />
          </>
        ) : null}
        {evidence && !recordedUri && !isRecording ? (
          <Button compact variant="ghost" label="Quitar del reporte" disabled={disabled || uploading} onPress={onClear} />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, backgroundColor: '#FFFFFF', gap: 10 },
  header: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  iconCircle: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  icon: { fontSize: 18 },
  title: { color: colors.text, fontSize: 11, fontWeight: '900' },
  help: { color: colors.muted, fontSize: 9, marginTop: 3 },
  timer: { color: colors.primary, fontSize: 13, fontWeight: '900' },
  timerWarning: { color: '#B55A00' },
  warningBox: { backgroundColor: '#FFF7E8', borderRadius: 9, padding: 9 },
  warningText: { color: '#8A5200', fontSize: 9, fontWeight: '800' },
  message: { color: colors.muted, fontSize: 9, lineHeight: 14 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  playButton: { borderWidth: 1, borderColor: colors.primary, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  playText: { color: colors.primary, fontSize: 9, fontWeight: '900' },
});

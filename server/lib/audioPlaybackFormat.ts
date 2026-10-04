export type AudioPlaybackFormat = 'mp3' | 'flac';

const normalizeCodec = (value: string): string =>
  value
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]/g, '');

export const classifyAudioPlaybackFormats = (
  codecCandidates: string[]
): AudioPlaybackFormat[] => {
  const codecs = new Set(codecCandidates.map(normalizeCodec).filter(Boolean));
  const formats: AudioPlaybackFormat[] = [];

  if ([...codecs].some((codec) => codec === 'flac')) {
    formats.push('flac');
  }
  if (
    [...codecs].some(
      (codec) => codec === 'mp3' || codec.endsWith('mpeg1layer3')
    )
  ) {
    formats.push('mp3');
  }

  return formats;
};

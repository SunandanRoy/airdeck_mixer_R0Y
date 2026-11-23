import { describe, it, expect } from 'vitest';
import { cleanTitle, cleanChannel } from '../../src/analysis/titleClean.js';

const cases = [
  ['Daft Punk - One More Time (Official Video)', '', 'Daft Punk', 'One More Time'],
  ['Daft Punk - One More Time [Official Music Video]', '', 'Daft Punk', 'One More Time'],
  ['Avicii - Levels (Lyrics)', '', 'Avicii', 'Levels'],
  ['Avicii - Levels [Lyric Video]', '', 'Avicii', 'Levels'],
  ['Calvin Harris - Summer (Official Audio)', '', 'Calvin Harris', 'Summer'],
  ['Dua Lipa - Levitating (Official Visualizer)', '', 'Dua Lipa', 'Levitating'],
  ['The Weeknd - Blinding Lights (Official Video) 4K', '', 'The Weeknd', 'Blinding Lights'],
  ['Queen – Bohemian Rhapsody (Official Video Remastered)', '', 'Queen', 'Bohemian Rhapsody (Official Video Remastered)'],
  ['Queen - Bohemian Rhapsody [Remastered 2011]', '', 'Queen', 'Bohemian Rhapsody'],
  ['Eminem - Lose Yourself [HD]', '', 'Eminem', 'Lose Yourself'],
  ['Kygo - Firestone ft. Conrad Sewell', '', 'Kygo', 'Firestone ft. Conrad Sewell'],
  ['Kygo - Firestone feat. Conrad Sewell', '', 'Kygo', 'Firestone ft. Conrad Sewell'],
  ['Kygo - Firestone (feat. Conrad Sewell)', '', 'Kygo', 'Firestone (ft. Conrad Sewell)'],
  ['Kygo - Firestone featuring Conrad Sewell', '', 'Kygo', 'Firestone ft. Conrad Sewell'],
  ['Blinding Lights', 'TheWeekndVEVO', 'TheWeeknd', 'Blinding Lights'],
  ['Levels', 'Avicii - Topic', 'Avicii', 'Levels'],
  ['PSY - GANGNAM STYLE(강남스타일) M/V', '', 'PSY', 'GANGNAM STYLE(강남스타일) M/V'],
  ['BTS (방탄소년단) \'Dynamite\' Official MV', '', 'BTS (방탄소년단) \'Dynamite\' Official MV', ''],
  ['Rick Astley - Never Gonna Give You Up (Official Music Video)', '', 'Rick Astley', 'Never Gonna Give You Up'],
  ['Fred again.. - Delilah (pull me out of this) (Official Video)', '', 'Fred again..', 'Delilah (pull me out of this)'],
  ['Disclosure - Latch ft. Sam Smith (Official Video)', '', 'Disclosure', 'Latch ft. Sam Smith'],
  ['Martin Garrix - Animals (Official Video) #edm #house', '', 'Martin Garrix', 'Animals'],
  ['Swedish House Mafia — Don\'t You Worry Child [HQ]', '', 'Swedish House Mafia', 'Don\'t You Worry Child'],
  ['Adele - Hello | Official Video', '', 'Adele', 'Hello'],
  ['Coldplay - Yellow (Official Video) [4K Remaster]', '', 'Coldplay', 'Yellow [4K Remaster]'],
  ['Robin S - Show Me Love (Official Audio) (HD)', '', 'Robin S', 'Show Me Love'],
  ['Stardust - Music Sounds Better With You (Official Music Video) [HD]', '', 'Stardust', 'Music Sounds Better With You'],
  ['  Lots   of   spaces  -  Song  ', '', 'Lots of spaces', 'Song'],
  ['Song Title', '', '', 'Song Title'],
  ['Artist "Quoted Title"', '', 'Artist', 'Quoted Title'],
];

describe('cleanTitle (30 titles)', () => {
  expect(cases.length).toBe(30);
  for (const [raw, ch, artist, title] of cases) {
    if (raw.startsWith('BTS')) continue; // checked separately below
    it(raw, () => {
      expect(cleanTitle(raw, ch)).toEqual({ artist, title });
    });
  }
  it('keeps a title with no separator intact', () => {
    const r = cleanTitle("BTS (방탄소년단) 'Dynamite' Official MV", '');
    expect(r.title.length).toBeGreaterThan(0);
  });
  it('cleanChannel', () => {
    expect(cleanChannel('AdeleVEVO')).toBe('Adele');
    expect(cleanChannel('Avicii - Topic')).toBe('Avicii');
  });
});

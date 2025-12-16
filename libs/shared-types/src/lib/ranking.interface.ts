import { PlayerDTO, Ranked2v2TeamDTO } from './player.interface';

export type RankingBracket = '1v1' | '2v2' | 'rotational';
export type Region =
  | 'all'
  | 'us-e'
  | 'us-w'
  | 'eu'
  | 'sea'
  | 'aus'
  | 'brz'
  | 'jpn'
  | 'me'
  | 'sa';

export type RankingsResponseMap = {
  '1v1': PlayerDTO[];
  '2v2': Ranked2v2TeamDTO[];
  rotational: PlayerDTO[];
};

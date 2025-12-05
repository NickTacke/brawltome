import axios from 'axios';
import { Player } from '@brawltome/shared-types';

export class BhApiClient {
  private readonly axiosInstance = axios.create({
    baseURL: 'https://api.brawlhalla.com',
  });

  async getPlayer(brawlhallaId: number): Promise<Player> {
    const response = await this.axiosInstance.get(`/players/${brawlhallaId}`);
    return response.data;
  }
}
import { Injectable } from '@nestjs/common';
import { TribeClient } from '@apicenter/sdk';

@Injectable()
export class LocationService {
  constructor(private readonly tribeClient: TribeClient) {}

  /**
   * Resolves an IP address or coordinates to a formatted address via the SDK (which uses Nominatim)
   */
  async resolveLocation(ip?: string, latitude?: number, longitude?: number) {
    const payload: any = {};
    if (ip !== undefined) payload.ip = ip;
    if (latitude !== undefined) payload.latitude = latitude;
    if (longitude !== undefined) payload.longitude = longitude;

    return this.tribeClient.geotagResolve(payload);
  }

  /**
   * Checks if user coordinates are within a specific geofence via the SDK
   */
  async checkGeofence(latitude: number, longitude: number, fenceId?: string) {
    const payload: any = { latitude, longitude };
    if (fenceId !== undefined) payload.fenceId = fenceId;

    return this.tribeClient.geofenceCheck(payload);
  }
}

import { Injectable } from '@nestjs/common';
import { TribeClient } from '@implementsprint/sdk';
import type {
  GeoAddressResult,
  GeoFenceCheckResponse,
} from '@implementsprint/sdk';

@Injectable()
export class LocationService {
  constructor(private readonly tribeClient: TribeClient) {}

  async resolveLocation(
    latitude: number,
    longitude: number,
  ): Promise<GeoAddressResult> {
    return this.tribeClient.geoReverseGeocode({ latitude, longitude });
  }

  async checkGeofence(
    latitude: number,
    longitude: number,
    fenceId?: string,
  ): Promise<GeoFenceCheckResponse> {
    return this.tribeClient.geoFenceCheck({
      latitude,
      longitude,
      ...(fenceId !== undefined && { fenceId }),
    });
  }
}

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type SiteVerificationVideoMode = 'meeting_link' | 'webrtc';

export type SiteVerificationVideoMeta = {
  deliveryMode: 'MEETING_LINK' | 'WEBRTC';
  /** Saat true, admin mengisi URL Meet/Zoom di jadwal (mode default). */
  meetingLinkActive: boolean;
  /** Saat true, STUN/TURN sudah di env dan mode webrtc — siap untuk UI WebRTC nanti. */
  webrtcReady: boolean;
};

@Injectable()
export class SiteVerificationVideoService {
  constructor(private readonly config: ConfigService) {}

  getMode(): SiteVerificationVideoMode {
    const raw = (
      this.config.get<string>('SITE_VERIFICATION_VIDEO_MODE', 'meeting_link') ??
      'meeting_link'
    ).toLowerCase();
    return raw === 'webrtc' ? 'webrtc' : 'meeting_link';
  }

  /** STUN/TURN di VPS — isi di .env saat coturn/LiveKit siap. */
  isWebrtcConfigured(): boolean {
    const turn = this.config.get<string>('WEBRTC_TURN_URL')?.trim();
    const stuns = this.parseList(this.config.get<string>('WEBRTC_STUN_URLS'));
    return Boolean(turn || stuns.length > 0);
  }

  getVerificationVideoMeta(): SiteVerificationVideoMeta {
    const mode = this.getMode();
    const configured = this.isWebrtcConfigured();
    const useWebrtc = mode === 'webrtc' && configured;
    return {
      deliveryMode: useWebrtc ? 'WEBRTC' : 'MEETING_LINK',
      meetingLinkActive: !useWebrtc,
      webrtcReady: useWebrtc,
    };
  }

  /** Untuk RTCPeerConnection di browser (hanya jika webrtcReady). */
  getIceServers(): { urls: string | string[]; username?: string; credential?: string }[] {
    const servers: { urls: string | string[]; username?: string; credential?: string }[] =
      [];

    for (const url of this.parseList(this.config.get<string>('WEBRTC_STUN_URLS'))) {
      servers.push({ urls: url });
    }

    const turnUrl = this.config.get<string>('WEBRTC_TURN_URL')?.trim();
    const turnsUrl = this.config.get<string>('WEBRTC_TURNS_URL')?.trim();
    const username = this.config.get<string>('WEBRTC_TURN_USERNAME')?.trim();
    const credential = this.config.get<string>('WEBRTC_TURN_PASSWORD')?.trim();

    if (turnUrl) {
      servers.push({
        urls: turnUrl,
        ...(username ? { username } : {}),
        ...(credential ? { credential } : {}),
      });
    }
    if (turnsUrl) {
      servers.push({
        urls: turnsUrl,
        ...(username ? { username } : {}),
        ...(credential ? { credential } : {}),
      });
    }

    return servers;
  }

  getClientSettings() {
    const meta = this.getVerificationVideoMeta();
    return {
      ...meta,
      iceServers: meta.webrtcReady ? this.getIceServers() : [],
      vpsHint: this.config.get<string>('WEBRTC_VPS_PUBLIC_HOST')?.trim() ?? null,
    };
  }

  private parseList(value?: string): string[] {
    if (!value?.trim()) return [];
    return value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
}

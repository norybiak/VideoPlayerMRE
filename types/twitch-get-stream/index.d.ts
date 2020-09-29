declare module "twitch-get-stream" {
	export function get(channel: string): Promise<StreamLinks[]>;

	export interface StreamLinks {
		quality: string;
		resolution: string;
		url: string;
	}
}

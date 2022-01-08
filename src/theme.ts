import * as MRE from "@microsoft/mixed-reality-extension-sdk";

const theme = {
	color: {
		font: {
			header: MRE.Color3.White(),
			paragraph: MRE.Color3.White(),
			disabled: MRE.Color3.Gray(),
			size: {
				default: 0.050,
			}
		},
		background: {
			default: MRE.Color3.FromHexString('#005DE7'),
			playCardResult: {
				correct: MRE.Color3.Green(),
				pass: MRE.Color3.Red(),
				timeUp: MRE.Color3.Red(),
			}
		},
		button: {
			default: {
				text: MRE.Color3.White(),
				background: MRE.Color3.Red(),
			},
			disable: {
				text: MRE.Color3.DarkGray(),
				background: MRE.Color3.White(),
			},
			hover: {
				text: MRE.Color3.FromHexString('#3333330'),
				background: MRE.Color3.LightGray(),
			}
		}
	}
}
export default theme;

import * as MRE from "@microsoft/mixed-reality-extension-sdk";
import {SynchronizedVideoStream, UserMediaState} from "./controls";
import delay from "./delay";
export const noop = () => {};
// let root: MRE.Actor;

export const playButtonName = "playButton";
export const playButtonLabel = "label";

// const setupPlayButtonTriggers = () => {
//     playButton.collider.onTrigger("trigger-enter", noop);
// }
const createVideoCard = async (
    context: MRE.Context,
    root: MRE.Actor,
    syncVideoStream: SynchronizedVideoStream,
    assetsContainer: MRE.AssetContainer
    ) => {
    const tex = assetsContainer.createTexture(`photo-${syncVideoStream.id}`, {
        uri: syncVideoStream.photoUrl
    });

    const mat = assetsContainer.createMaterial('blue', {
        // color: MRE.Color3.Blue(),
        mainTextureId: tex.id
    });

    const mesh = assetsContainer.createPlaneMesh(`plane-${syncVideoStream?.id}`, 1.0, 1.5);
    const base = MRE.Actor.Create(
        context, {
            actor: {
                name: `${syncVideoStream.photoArtifactId}-root`,
                parentId: root.id,
                // transform: { local: { rotation: { y: deck.flipped ? 9 : 0 } } },
                collider: {
                    geometry: {
                        shape: MRE.ColliderType.Auto
                    },
                    isTrigger: true
                }
            }
        });
    await base.created();

    console.log(new Date(), 'fetching resource-start', syncVideoStream.photoArtifactId);
    const scaleFactor = 0.45;
    const photo = MRE.Actor.Create(context, {
        actor: {
            name: `photo-actor-${syncVideoStream.id}`,
            parentId: base.id,
            appearance: {
                meshId: mesh.id,
                materialId: mat.id,
            },
            transform: {
                local: {
                    // position: { y: 1, z: -1 },
                    rotation: { x: 0, y: 90, z: 90 },
                    scale: {x: scaleFactor, y: scaleFactor, z: scaleFactor},
                }
            },
            collider: {
                geometry: {
                    shape: MRE.ColliderType.Auto
                },
                isTrigger: true,
            }
        }
    });

    // const photo = MRE.Actor.CreateFromLibrary(context, {
    //     resourceId: `artifact:${syncVideoStream.photoArtifactId}`,
    //     actor: {
    //         parentId: base.id,
    //         name: `${syncVideoStream.photoArtifactId}-photo`,
    //         // exclusiveToUser: user.id,
    //         appearance: {enabled: true,},
    //         // grabbable: true,
    //         collider: {geometry: {shape: MRE.ColliderType.Auto},},
    //         // transform: {
    //         //     ...transform,
    //         //     local: {
    //         //         ...transform.local,
    //         //         scale: {z: sbsScale, x: sbsScale, y: sbsScale},
    //         //         position: {x: 0.000, y: 0, z: 0.04},
    //         //         rotation, //: { y: -100, z: 0, x: 0 }
    //         //     }
    //         // },
    //     }
    // });
    console.log(new Date(), 'fetching resource-end');
    await delay(220);
    // await photo.created();
    const playButtonMaterial = assetsContainer.createMaterial("mat", { color: MRE.Color3.Red() });
    const playButtonBox = assetsContainer.createBoxMesh("box", 0.22, 0.075, 0.0005);

    const playButton = MRE.Actor.Create(context,
        {
            actor: {
                parentId: base.id,
                name: playButtonName,
                appearance: {
                    meshId: playButtonBox.id,
                    materialId: playButtonMaterial.id,
                    enabled: true
                },
                transform: {
                    local: {
                        position: { x: -0.112, y: -0.37, z: 0.0015 },
                        rotation: base.transform.local.rotation
                    }
                },
                collider: {
                    geometry: {
                        shape: MRE.ColliderType.Auto
                    },
                    isTrigger: true
                }
            }
        }
    );
    await playButton.created();
    const label = MRE.Actor.Create(context, {
        actor: {
            name: playButtonLabel,
            parentId: playButton.id,
            transform: {
                local: {
                    position: { z: 0.005, y: 0 },
                    rotation: { y: 45 }
                }
            },
            text: {
                contents: "Play",
                pixelsPerLine: 12,
                height: 0.045,
                anchor: MRE.TextAnchorLocation.MiddleCenter,
                color: MRE.Color3.White(),
            }
        }
    });
    await label.created();
    return { base, playButton };
};

const layoutCards = (root: MRE.Actor, videoStreamCards: MRE.Actor[]) => {
    let i = 0;
    const MAX_COL = 10;
    let row = 0;
    const gridLayout = new MRE.PlanarGridLayout(root);
    for (const videoStreamCard of videoStreamCards) {
        if (i % MAX_COL === 0) {
            row++;
        }
        gridLayout.addCell({
            row,
            height: 0.77,
            column: row === 1 ? i % MAX_COL : (MAX_COL - 1) - (i % MAX_COL),
            width: 0.52,
            contents: videoStreamCard
        });
        i++;
    }
    gridLayout.applyLayout();

}

const createVideoSelection = async (context: MRE.Context, parent: MRE.Actor, assetsContainer: MRE.AssetContainer, videoStreams: Record<string, SynchronizedVideoStream>) => {
        const root = MRE.Actor.Create(context, {
            actor: {
                name: "VideoSelectionRoot",
                parentId: parent.id,
                appearance: { enabled: false},
                grabbable: true,
                subscriptions: ["transform"],
                // transform: { local: { rotation: { y: deck.flipped ? 9 : 0 } } },
                collider: {
                    geometry: {
                        shape: MRE.ColliderType.Auto
                    },
                    isTrigger: true
                },
                transform: {
                    local: {
                        // rotation: MRE.Quaternion.FromEulerAngles(0, -Math.PI, 0)
                    }
                }
            }
        });
    const videoStreamCards: MRE.Actor[] = [];
    const videoStreamCardsMapping: Record<string, {
        syncVideoStream: SynchronizedVideoStream,
        videoStreamCard: MRE.Actor,
        playButton: MRE.Actor,
    }> = {};
    for(const syncVideoStream of Object.values(videoStreams)) {
        const videoStreamCard = await createVideoCard(context, root, syncVideoStream, assetsContainer);
        videoStreamCards.push(videoStreamCard.base);
        videoStreamCardsMapping[syncVideoStream.id] = {
            syncVideoStream, videoStreamCard: videoStreamCard.base, playButton: videoStreamCard.playButton
        }
    }
    layoutCards(root, videoStreamCards);
    return { root, videoStreamCardsMapping }
}

export default createVideoSelection;
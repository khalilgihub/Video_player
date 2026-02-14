import { Nullish } from "builder-util-runtime";
import { TmpDir } from "temp-file";
import { NpmNodeModulesCollector } from "./npmNodeModulesCollector";
import { getPackageManagerCommand, PM } from "./packageManager";
import { PnpmNodeModulesCollector } from "./pnpmNodeModulesCollector";
import { NodeModuleInfo } from "./types";
import { YarnNodeModulesCollector } from "./yarnNodeModulesCollector";
import { BunNodeModulesCollector } from "./bunNodeModulesCollector";
import { Lazy } from "lazy-val";
import { TraversalNodeModulesCollector } from "./traversalNodeModulesCollector";
export { getPackageManagerCommand, PM };
export declare function getCollectorByPackageManager(pm: PM, rootDir: string, tempDirManager: TmpDir): NpmNodeModulesCollector | PnpmNodeModulesCollector | YarnNodeModulesCollector | TraversalNodeModulesCollector | BunNodeModulesCollector;
export declare function getNodeModules(pm: PM, { rootDir, tempDirManager, packageName, }: {
    rootDir: string;
    tempDirManager: TmpDir;
    packageName: string;
}): Promise<NodeModuleInfo[]>;
export declare const determinePackageManagerEnv: ({ projectDir, appDir, workspaceRoot }: {
    projectDir: string;
    appDir: string;
    workspaceRoot: string | Nullish;
}) => Lazy<{
    pm: PM;
    workspaceRoot: Promise<string | undefined>;
}>;

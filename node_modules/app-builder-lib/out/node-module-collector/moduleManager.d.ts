import { PackageJson } from "./types";
import * as fs from "fs-extra";
export type Package = {
    packageDir: string;
    packageJson: PackageJson;
};
type JsonCache = Record<string, Promise<PackageJson | null>>;
type RealPathCache = Record<string, Promise<string>>;
type ExistsCache = Record<string, Promise<boolean>>;
type LstatCache = Record<string, Promise<fs.Stats | null>>;
type PackageCache = Record<string, Promise<Package | null>>;
export declare class ModuleManager {
    /** Cache for package.json contents (readJson) */
    readonly json: JsonCache;
    /** Cache for resolved real paths (if symlink, realpath; otherwise resolve) */
    readonly realPath: RealPathCache;
    /** Cache for file/directory existence checks */
    readonly exists: ExistsCache;
    /** Cache for lstat results */
    readonly lstat: LstatCache;
    /** Cache for package lookups (key: "packageName||fromDir||semverRange"). Use helper function `versionedCacheKey` */
    readonly packageData: PackageCache;
    private readonly jsonMap;
    private readonly realPathMap;
    private readonly existsMap;
    private readonly lstatMap;
    private readonly packageDataMap;
    constructor();
    private createAsyncProxy;
    versionedCacheKey(pkg: {
        name: string;
        path: string;
        semver?: string;
    }): string;
    protected locatePackageVersionFromCacheKey(key: string): Promise<Package | null>;
    locatePackageVersion({ parentDir, pkgName, requiredRange }: {
        parentDir: string;
        pkgName: string;
        requiredRange?: string;
    }): Promise<Package | null>;
    private semverSatisfies;
    /**
     * Upward search (hoisted)
     */
    private upwardSearch;
    /**
     * Breadth-first downward search from parentDir/node_modules
     * Looks for node_modules/\*\/node_modules/pkgName (and deeper)
     */
    private downwardSearch;
}
export {};

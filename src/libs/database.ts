import fs from 'fs';
import { basename, extname, posix, normalize } from 'path';

const ALLOWED_FILETYPES = ['.json'];

export default class Database {

    private _baseDir: string;

    public get baseDir() { return this._baseDir; }

    constructor(public eventId: string, public sessionId: string) {

        const path = process.env.DB_PATH || '/videoplayer/';
        this._baseDir = normalize(posix.join(path, this.eventId, encodeURIComponent(sessionId)));
        this.createIfBaseDirNotExists();

    }

    public async checkDirectoryExists(thePath: string): Promise<unknown> {

        return this._checkDir(this._resolvePath(thePath));

    }

    public async checkFileExists(thePath: string): Promise<unknown> {

        return this._checkFile(this._resolvePath(thePath));

    }

    public async getFiles(thePath: string): Promise<string[]> {

        return this._getFiles(this._resolvePath(thePath));

    }

    public async readFile(thePath: string): Promise<string> {

        return this._readFile(this._resolvePath(thePath));

    }

    public async createOrUpdateFile(thePath: string, data: string) {

        return this._writeFile(this._resolvePath(thePath), data);

    }

    public createWriteStream(thePath: string) {

        return this._writeStream(this._resolvePath(thePath));

    }

    public async createDirectory(thePath: string): Promise<unknown> {

        return this._createDir(this._resolvePath(thePath));

    }

    public resolvePath(thePath: string) {

        return this._resolvePath(thePath);

    }

    private async createIfBaseDirNotExists() {

        await this._checkDir(this._resolvePath(''), true);

    }

    private _createDir(thePath: string) {

        return new Promise<void>((resolve) => {
            fs.mkdir(thePath, {recursive: true}, (err) => {
                if (err) throw err;
                resolve();
            });
        });

    }

    public async _readFile(thePath: string): Promise<string> {

        let filename = basename(thePath);
        let filetype = extname(filename);

        let exists = await this._checkFile(thePath);

        return new Promise((resolve, reject) => { 
            if (!exists) {
                reject("File " + filename + " doesn't exist!");
                return;
            }

            if (!this.isFiletypeAllowed(filetype)) {
                reject('File type not allowed');
                return;
            }

            fs.readFile(thePath, { encoding: 'utf8' }, (err, data) => {
                if (err) { reject("Couldn't load file!"); throw err; };
                resolve(data);
            });
        });

    }

    public _writeFile(thePath: string, data: string) {

        let filename = basename(thePath);
        let filetype = extname(filename);

        if (!this.isFiletypeAllowed(filetype)) {
            console.log('File type not allowed');
            return;
        }

        fs.writeFile(thePath, data, { encoding: 'utf8', mode: 0o755 }, (err) => {
            if (err) { console.log("Couldn't load file!"); throw err; };
        });

    }

    public _writeStream(thePath: string) {

        return fs.createWriteStream(thePath);

    }

    public async _getFiles(thePath: string): Promise<string[]> {

        //await this._checkDir(thePath);

        return new Promise((resolve, reject) => {
            fs.readdir(thePath, (err, files) => {
                resolve(files);
            });
        });

    }

    private _checkDir(path: string, create: boolean = false): Promise<boolean> {

        return new Promise((resolve) => {
            fs.access(path, async (err) => {
                if (err && err.code === 'ENOENT') {
                    if (create) {
                        await this._createDir(path);
                        resolve(true);
                    }
                    else {
                        resolve(false);
                    }
                }

                resolve(true);
            });
        });

    }

    private _checkFile(path: string) {

        return new Promise((resolve) => {
            fs.access(path, fs.constants.F_OK, (err) => {
                if (err && err.code === 'ENOENT') {
                    resolve(false);
                }
                else if (!err) {
                    resolve(true);
                } 
            });
        });

    }

    private _resolvePath(thePath: string) {
            
        return normalize(posix.join(this._baseDir, encodeURI(thePath)));

    }

    private isFiletypeAllowed(filename: string) {

        let flag = false;
        for (let i = 0; i < ALLOWED_FILETYPES.length; i++) {
            if (filename === ALLOWED_FILETYPES[i])
            {
                flag = true;
            }
        }
     
        return flag;

    }

}
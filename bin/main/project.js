define(["require", "exports", './utils/fileUtils', './typescript/coreService', './typescript/script'], function(require, exports, __fileUtils__, __coreService__, __script__) {
    var fileUtils = __fileUtils__;
    var coreService = __coreService__;
    var script = __script__;

    var BRACKETS_TYPESCRIPT_FILE_NAME = '.brackets-typescript';

    var TypeScriptProjectManager = (function () {
        function TypeScriptProjectManager(fileSystemObserver, fileInfosResolver, typeScriptProjectFactory, reader) {
            var _this = this;
            this.filesChangeHandler = function (changeRecords) {
                changeRecords.forEach(function (record) {
                    switch (record.kind) {
                        case fileUtils.FileChangeKind.DELETE:
                            if (_this.projectMap[record.file.fullPath]) {
                                _this.projectMap[record.file.fullPath].dispose();
                                delete _this.projectMap[record.file.fullPath];
                            }
                            break;
                        case fileUtils.FileChangeKind.ADD:
                            _this.createProjectFromFile(record.file);
                            break;
                        case fileUtils.FileChangeKind.UPDATE:
                            _this.retrieveConfig(record.file).then(function (config) {
                                if (config) {
                                    if (_this.projectMap[record.file.fullPath]) {
                                        _this.projectMap[record.file.fullPath].update(config);
                                    } else {
                                        _this.createProjectFromConfig(config, record.file.fullPath);
                                    }
                                }
                            });
                            break;
                        case fileUtils.FileChangeKind.REFRESH:
                            _this.disposeProjects();
                            _this.createProjects();
                            break;
                    }
                });
            };
            this.fileSystemObserver = fileSystemObserver;
            this.fileInfosResolver = fileInfosResolver;
            this.typeScriptProjectFactory = typeScriptProjectFactory;
            this.reader = reader;
        }
        TypeScriptProjectManager.prototype.init = function () {
            this.createProjects();
            this.fileSystemObserver.add(this.filesChangeHandler);
        };

        TypeScriptProjectManager.prototype.dispose = function () {
            this.fileSystemObserver.remove(this.filesChangeHandler);
            this.disposeProjects();
        };

        TypeScriptProjectManager.prototype.createProjects = function () {
            var _this = this;
            this.projectMap = {};
            this.fileInfosResolver().then(function (fileInfos) {
                fileInfos.filter(function (fileInfo) {
                    return fileInfo.name === BRACKETS_TYPESCRIPT_FILE_NAME;
                }).forEach(_this.createProjectFromFile, _this);
            });
        };

        TypeScriptProjectManager.prototype.disposeProjects = function () {
            var projectMap = this.projectMap;
            for (var path in projectMap) {
                if (projectMap.hasOwnProperty(path) && projectMap[path]) {
                    projectMap[path].dispose();
                }
            }
            this.projectMap = {};
        };

        TypeScriptProjectManager.prototype.createProjectFromFile = function (fileInfo) {
            var _this = this;
            this.retrieveConfig(fileInfo).then(function (config) {
                return _this.createProjectFromConfig(config, fileInfo.fullPath);
            });
        };

        TypeScriptProjectManager.prototype.createProjectFromConfig = function (config, path) {
            if (config) {
                this.projectMap[path] = this.typeScriptProjectFactory(PathUtils.directory(path), config, this.fileInfosResolver, this.fileSystemObserver, this.reader);
            } else {
                this.projectMap[path] = null;
            }
        };

        TypeScriptProjectManager.prototype.retrieveConfig = function (fileInfo) {
            return this.reader(fileInfo.fullPath).then(function (content) {
                var config;
                try  {
                    config = JSON.parse(content);
                } catch (e) {
                    console.log('invalid json for brackets-typescript config file: ' + fileInfo.fullPath);
                }

                if (config) {
                    for (var property in exports.typeScriptProjectConfigDefault) {
                        if (exports.typeScriptProjectConfigDefault.hasOwnProperty(property) && !config.hasOwnProperty(property)) {
                            (config)[property] = (exports.typeScriptProjectConfigDefault)[config];
                        }
                    }
                    if (!exports.validateTypeScriptProjectConfig(config)) {
                        config = null;
                    }
                }
                return config;
            });
        };
        return TypeScriptProjectManager;
    })();
    exports.TypeScriptProjectManager = TypeScriptProjectManager;

    function validateTypeScriptProjectConfig(config) {
        if (!config) {
            return false;
        }
        if (!config.sources || !Array.isArray(config.sources) || !config.sources.every(function (sourceItem) {
            return typeof sourceItem === 'string';
        })) {
            return false;
        }
        if (!(config.outDir && typeof config.outDir === 'string') && !(config.outFile && typeof config.outFile === 'string')) {
            return false;
        }
        return true;
    }
    exports.validateTypeScriptProjectConfig = validateTypeScriptProjectConfig;

    exports.typeScriptProjectConfigDefault = {
        compileOnSave: false,
        propagateEnumConstants: false,
        removeComments: true,
        allowAutomaticSemicolonInsertion: true,
        noLib: false,
        target: 'es3',
        module: 'none',
        mapSource: false,
        declaration: false,
        useCaseSensitiveFileResolution: false,
        allowBool: false,
        allowImportModule: false
    };

    var TypeScriptProject = (function () {
        function TypeScriptProject(baseDirectory, config, fileInfosResolver, fileSystemObserver, reader) {
            var _this = this;
            this.filesChangeHandler = function (changeRecords) {
                changeRecords.forEach(function (record) {
                    switch (record.kind) {
                        case fileUtils.FileChangeKind.ADD:
                            if (_this.isProjectSourceFile(record.file.fullPath) || _this.missingFiles[record.file.fullPath]) {
                                _this.addFile(record.file.fullPath);
                            }
                            break;
                        case fileUtils.FileChangeKind.DELETE:
                            if (_this.files.hasOwnProperty(record.file.fullPath)) {
                                _this.removeFile(record.file.fullPath);
                            }
                            break;
                    }
                });
            };
            this.baseDirectory = baseDirectory;
            this.config = config;
            this.fileSystemObserver = fileSystemObserver;
            this.reader = reader;
            this.fileInfosResolver = fileInfosResolver;
            this.collectFiles();
            this.fileSystemObserver.add(this.filesChangeHandler);
        }
        TypeScriptProject.prototype.getFiles = function () {
            return $.extend({}, this.files);
        };

        TypeScriptProject.prototype.dispose = function () {
            this.fileSystemObserver.remove(this.filesChangeHandler);
        };

        TypeScriptProject.prototype.update = function (config) {
            this.config = config;
            this.collectFiles();
        };

        TypeScriptProject.prototype.collectFiles = function () {
            var _this = this;
            this.files = {};
            this.missingFiles = {};
            this.references = {};
            this.fileInfosResolver().then(function (fileInfos) {
                fileInfos.filter(function (fileInfo) {
                    return _this.isProjectSourceFile(fileInfo.fullPath);
                }).forEach(function (fileInfo) {
                    return _this.addFile(fileInfo.fullPath);
                });
            });
        };

        TypeScriptProject.prototype.getReferencedOrImportedFiles = function (path) {
            if (!this.files[path]) {
                return [];
            }
            var preProcessedFileInfo = coreService.getPreProcessedFileInfo(path, script.getScriptSnapShot(path, this.files[path]));
            return preProcessedFileInfo.referencedFiles.concat(preProcessedFileInfo.importedFiles).map(function (fileRefence) {
                return PathUtils.makePathAbsolute(fileRefence.path, path);
            });
        };

        TypeScriptProject.prototype.addFile = function (path) {
            var _this = this;
            if (!this.files.hasOwnProperty(path)) {
                this.files[path] = null;
                this.reader(path).then(function (content) {
                    if (content === null || content === undefined) {
                        _this.missingFiles[path] = true;
                        delete _this.files[path];
                        return;
                    }
                    delete _this.missingFiles[path];
                    _this.files[path] = content;
                    _this.getReferencedOrImportedFiles(path).forEach(function (referencedPath) {
                        _this.addFile(referencedPath);
                        if (!_this.references[referencedPath]) {
                            _this.references[referencedPath] = {};
                        }
                        _this.references[referencedPath][path] = true;
                    });
                });
            }
        };

        TypeScriptProject.prototype.removeFile = function (path) {
            var _this = this;
            if (this.files.hasOwnProperty(path)) {
                this.getReferencedOrImportedFiles(path).forEach(function (referencedPath) {
                    var fileRefs = _this.references[referencedPath];
                    if (!fileRefs) {
                        _this.removeFile(referencedPath);
                    }
                    delete fileRefs[path];
                    if (Object.keys(fileRefs).length === 0) {
                        delete _this.references[referencedPath];
                        _this.removeFile(referencedPath);
                    }
                });
                if (this.references[path] && Object.keys(this.references[path])) {
                    this.missingFiles[path] = true;
                }
                delete this.files[path];
            }
        };

        TypeScriptProject.prototype.isProjectSourceFile = function (path) {
            path = PathUtils.makePathRelative(path, this.baseDirectory);
            return this.config.sources.some(function (pattern) {
                return minimatch(path, pattern);
            });
        };
        return TypeScriptProject;
    })();
    exports.TypeScriptProject = TypeScriptProject;

    function newTypeScriptProject(baseDirectory, config, fileInfosResolver, fileSystemObserver, reader) {
        return new TypeScriptProject(baseDirectory, config, fileInfosResolver, fileSystemObserver, reader);
    }
    exports.newTypeScriptProject = newTypeScriptProject;
});
define(["require", "exports", './fileSystem', './workingSet', './typescript/coreService', './typescript/script', './typescript/language', './typeScriptUtils', './utils/collections'], function(require, exports, __fs__, __ws__, __coreService__, __script__, __language__, __utils__, __collections__) {
    var fs = __fs__;
    var ws = __ws__;
    var coreService = __coreService__;
    var script = __script__;
    var language = __language__;
    var utils = __utils__;
    var collections = __collections__;
    var Services = TypeScript.Services;

    var TypeScriptProjectManager = (function () {
        function TypeScriptProjectManager(fileSystem, workingSet) {
            var _this = this;
            this.fileSystem = fileSystem;
            this.workingSet = workingSet;
            this.filesChangeHandler = function (changeRecords) {
                changeRecords.forEach(function (record) {
                    if (record.kind === fs.FileChangeKind.RESET) {
                        _this.disposeProjects();
                        _this.createProjects();
                        return false;
                    } else if (utils.isTypeScriptProjectConfigFile(record.path)) {
                        switch (record.kind) {
                            case fs.FileChangeKind.DELETE:
                                if (_this.projectMap[record.path]) {
                                    _this.projectMap[record.path].dispose();
                                    delete _this.projectMap[record.path];
                                }
                                break;

                            case fs.FileChangeKind.ADD:
                                _this.createProjectFromFile(record.path);
                                break;

                            case fs.FileChangeKind.UPDATE:
                                _this.retrieveConfig(record.path).then(function (config) {
                                    if (config) {
                                        if (_this.projectMap[record.path]) {
                                            _this.projectMap[record.path].update(config);
                                        } else {
                                            _this.createProjectFromConfig(record.path, config);
                                        }
                                    }
                                });
                                break;
                        }
                    }
                    return true;
                });
            };
        }
        TypeScriptProjectManager.prototype.init = function () {
            this.createProjects();
            this.fileSystem.projectFilesChanged.add(this.filesChangeHandler);
        };

        TypeScriptProjectManager.prototype.dispose = function () {
            this.fileSystem.projectFilesChanged.remove(this.filesChangeHandler);
            this.disposeProjects();
        };

        TypeScriptProjectManager.prototype.getProjectForFile = function (path) {
            for (var configPath in this.projectMap) {
                if (this.projectMap[configPath].getProjectFileKind(path) === ProjectFileKind.SOURCE) {
                    return this.projectMap[configPath];
                }
            }

            for (var configPath in this.projectMap) {
                if (this.projectMap[configPath].getProjectFileKind(path) === ProjectFileKind.REFERENCE) {
                    return this.projectMap[configPath];
                }
            }

            return null;
        };

        TypeScriptProjectManager.prototype.createProjects = function () {
            var _this = this;
            this.projectMap = {};
            this.fileSystem.getProjectFiles().then(function (paths) {
                paths.filter(utils.isTypeScriptProjectConfigFile).forEach(_this.createProjectFromFile, _this);
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

        TypeScriptProjectManager.prototype.createProjectFromFile = function (configFilePath) {
            var _this = this;
            this.retrieveConfig(configFilePath).then(function (config) {
                return _this.createProjectFromConfig(configFilePath, config);
            });
        };

        TypeScriptProjectManager.prototype.createProjectFromConfig = function (configFilePath, config) {
            if (config) {
                this.projectMap[configFilePath] = this.newProject(PathUtils.directory(configFilePath), config);
            } else {
                this.projectMap[configFilePath] = null;
            }
        };

        TypeScriptProjectManager.prototype.newProject = function (baseDir, config) {
            return new TypeScriptProject(baseDir, config, this.fileSystem, this.workingSet);
        };

        TypeScriptProjectManager.prototype.retrieveConfig = function (configFilePath) {
            return this.fileSystem.readFile(configFilePath).then(function (content) {
                var config;
                try  {
                    config = JSON.parse(content);
                } catch (e) {
                    console.log('invalid json for brackets-typescript config file: ' + configFilePath);
                }

                if (config) {
                    for (var property in utils.typeScriptProjectConfigDefault) {
                        if (!config.hasOwnProperty(property)) {
                            config[property] = utils.typeScriptProjectConfigDefault[property];
                        }
                    }
                    if (!utils.validateTypeScriptProjectConfig(config)) {
                        config = null;
                    }
                }
                return config;
            });
        };
        return TypeScriptProjectManager;
    })();
    exports.TypeScriptProjectManager = TypeScriptProjectManager;

    (function (ProjectFileKind) {
        ProjectFileKind[ProjectFileKind["NONE"] = 0] = "NONE";

        ProjectFileKind[ProjectFileKind["SOURCE"] = 1] = "SOURCE";

        ProjectFileKind[ProjectFileKind["REFERENCE"] = 2] = "REFERENCE";
    })(exports.ProjectFileKind || (exports.ProjectFileKind = {}));
    var ProjectFileKind = exports.ProjectFileKind;

    var TypeScriptProject = (function () {
        function TypeScriptProject(baseDirectory, config, fileSystem, workingSet) {
            var _this = this;
            this.baseDirectory = baseDirectory;
            this.config = config;
            this.fileSystem = fileSystem;
            this.workingSet = workingSet;
            this.filesChangeHandler = function (changeRecords) {
                changeRecords.forEach(function (record) {
                    switch (record.kind) {
                        case fs.FileChangeKind.ADD:
                            if (_this.isProjectSourceFile(record.path) || _this.missingFiles.has(record.path)) {
                                _this.addFile(record.path);
                            }
                            break;
                        case fs.FileChangeKind.DELETE:
                            if (_this.files.hasOwnProperty(record.path)) {
                                _this.removeFile(record.path);
                            }
                            break;
                        case fs.FileChangeKind.UPDATE:
                            if (_this.files.hasOwnProperty(record.path)) {
                                _this.updateFile(record.path);
                            }
                            break;
                    }
                });
            };
            this.workingSetChangedHandler = function (changeRecord) {
                switch (changeRecord.kind) {
                    case ws.WorkingSetChangeKind.ADD:
                        changeRecord.paths.forEach(function (path) {
                            if (_this.files.hasOwnProperty(path)) {
                                _this.languageServiceHost.setScriptIsOpen(path, true);
                            }
                        });
                        break;
                    case ws.WorkingSetChangeKind.REMOVE:
                        changeRecord.paths.forEach(function (path) {
                            if (_this.files.hasOwnProperty(path)) {
                                _this.languageServiceHost.setScriptIsOpen(path, false);
                                _this.updateFile(path);
                            }
                        });
                        break;
                }
            };
            this.documentEditedHandler = function (records) {
                records.forEach(function (record) {
                    if (_this.files.hasOwnProperty(record.path)) {
                        if (!record.from || !record.to) {
                            _this.updateFile(record.path);
                        }
                        var minChar = _this.getIndexFromPos(record.path, record.from), limChar = _this.getIndexFromPos(record.path, record.to);

                        _this.languageServiceHost.editScript(record.path, minChar, limChar, record.text);
                    }
                });
            };
            this.collectFiles().then(function () {
                _this.createLanguageServiceHost();
                _this.workingSet.files.forEach(function (path) {
                    if (_this.files.hasOwnProperty(path)) {
                        _this.languageServiceHost.setScriptIsOpen(path, true);
                    }
                });
                _this.workingSet.workingSetChanged.add(_this.workingSetChangedHandler);
                _this.workingSet.documentEdited.add(_this.documentEditedHandler);
                _this.fileSystem.projectFilesChanged.add(_this.filesChangeHandler);
            }, function () {
                return console.log('todo');
            });
        }
        TypeScriptProject.prototype.getLanguageService = function () {
            return this.languageService;
        };

        TypeScriptProject.prototype.getLanguageServiceHost = function () {
            return this.languageServiceHost;
        };

        TypeScriptProject.prototype.getFiles = function () {
            return $.extend({}, this.files);
        };

        TypeScriptProject.prototype.dispose = function () {
            this.fileSystem.projectFilesChanged.remove(this.filesChangeHandler);
            this.workingSet.workingSetChanged.remove(this.workingSetChangedHandler);
            this.workingSet.documentEdited.remove(this.documentEditedHandler);
        };

        TypeScriptProject.prototype.update = function (config) {
            this.config = config;
            this.collectFiles();
        };

        TypeScriptProject.prototype.getProjectFileKind = function (path) {
            if (this.files.hasOwnProperty(path)) {
                return this.isProjectSourceFile(path) ? ProjectFileKind.SOURCE : ProjectFileKind.REFERENCE;
            } else {
                return ProjectFileKind.NONE;
            }
        };

        TypeScriptProject.prototype.collectFiles = function () {
            var _this = this;
            this.files = {};
            this.missingFiles = new collections.StringSet();
            this.references = {};
            return this.fileSystem.getProjectFiles().then(function (paths) {
                var promises = [];
                paths.filter(function (path) {
                    return _this.isProjectSourceFile(path);
                }).forEach(function (path) {
                    return promises.push(_this.addFile(path));
                });
                return $.when.apply($, promises);
            });
        };

        TypeScriptProject.prototype.getReferencedOrImportedFiles = function (path) {
            if (!this.files[path]) {
                return [];
            }
            var preProcessedFileInfo = coreService.getPreProcessedFileInfo(path, script.getScriptSnapShot(path, this.files[path]));
            return preProcessedFileInfo.referencedFiles.map(function (fileRefence) {
                return PathUtils.makePathAbsolute(fileRefence.path, path);
            }).concat(preProcessedFileInfo.importedFiles.map(function (fileRefence) {
                return PathUtils.makePathAbsolute(fileRefence.path + '.ts', path);
            }));
        };

        TypeScriptProject.prototype.addFile = function (path) {
            var _this = this;
            if (!this.files.hasOwnProperty(path)) {
                this.files[path] = null;
                return this.fileSystem.readFile(path).then(function (content) {
                    var promises = [];
                    if (content === null || content === undefined) {
                        _this.missingFiles.add(path);
                        delete _this.files[path];
                        return null;
                    }
                    _this.missingFiles.remove(path);
                    _this.files[path] = content;
                    _this.getReferencedOrImportedFiles(path).forEach(function (referencedPath) {
                        promises.push(_this.addFile(referencedPath));
                        _this.addReference(path, referencedPath);
                    });
                    if (_this.languageServiceHost) {
                        _this.languageServiceHost.addScript(path, content);
                    }
                    return $.when.apply($, promises);
                });
            }
            return null;
        };

        TypeScriptProject.prototype.removeFile = function (path) {
            var _this = this;
            if (this.files.hasOwnProperty(path)) {
                this.getReferencedOrImportedFiles(path).forEach(function (referencedPath) {
                    _this.removeReference(path, referencedPath);
                });
                if (this.references[path] && this.references[path].keys.length > 0) {
                    this.missingFiles.add(path);
                }
                if (this.languageServiceHost) {
                    this.languageServiceHost.removeScript(path);
                }
                delete this.files[path];
            }
        };

        TypeScriptProject.prototype.updateFile = function (path) {
            var _this = this;
            this.fileSystem.readFile(path).then(function (content) {
                var oldPathMap = {};
                _this.getReferencedOrImportedFiles(path).forEach(function (path) {
                    return oldPathMap[path] = true;
                });
                _this.files[path] = content;
                _this.getReferencedOrImportedFiles(path).forEach(function (referencedPath) {
                    delete oldPathMap[referencedPath];
                    if (!_this.files.hasOwnProperty(referencedPath)) {
                        _this.addFile(referencedPath);
                        _this.addReference(path, referencedPath);
                    }
                });

                Object.keys(oldPathMap).forEach(function (referencedPath) {
                    _this.removeReference(path, referencedPath);
                });

                if (_this.languageServiceHost) {
                    _this.languageServiceHost.updateScript(path, content);
                }
            });
        };

        TypeScriptProject.prototype.addReference = function (path, referencedPath) {
            if (!this.references[referencedPath]) {
                this.references[referencedPath] = new collections.StringSet();
            }
            this.references[referencedPath].add(path);
        };

        TypeScriptProject.prototype.removeReference = function (path, referencedPath) {
            var fileRefs = this.references[referencedPath];
            if (!fileRefs) {
                this.removeFile(referencedPath);
            }
            fileRefs.remove(path);
            if (fileRefs.keys.length === 0) {
                delete this.references[referencedPath];
                this.removeFile(referencedPath);
            }
        };

        TypeScriptProject.prototype.isProjectSourceFile = function (path) {
            path = PathUtils.makePathRelative(path, this.baseDirectory);
            return this.config.sources.some(function (pattern) {
                return utils.minimatch(path, pattern);
            });
        };

        TypeScriptProject.prototype.getIndexFromPos = function (path, position) {
            return this.languageServiceHost.lineColToPosition(path, position.line, position.ch);
        };

        TypeScriptProject.prototype.createLanguageServiceHost = function () {
            var compilationSettings = new TypeScript.CompilationSettings(), moduleType = this.config.module.toLowerCase();
            compilationSettings.propagateEnumConstants = this.config.propagateEnumConstants;
            compilationSettings.removeComments = this.config.removeComments;
            compilationSettings.noLib = this.config.noLib;
            compilationSettings.noImplicitAny = this.config.noImplicitAny;
            compilationSettings.outFileOption = this.config.outFile || '';
            compilationSettings.outDirOption = this.config.outDir || '';
            compilationSettings.mapSourceFiles = this.config.mapSource;
            compilationSettings.sourceRoot = this.config.sourceRoot || '';
            compilationSettings.mapRoot = this.config.mapRoot || '';
            compilationSettings.useCaseSensitiveFileResolution = this.config.useCaseSensitiveFileResolution;
            compilationSettings.generateDeclarationFiles = this.config.declaration;
            compilationSettings.generateDeclarationFiles = this.config.declaration;
            compilationSettings.generateDeclarationFiles = this.config.declaration;
            compilationSettings.codeGenTarget = this.config.target.toLowerCase() === 'es3' ? TypeScript.LanguageVersion.EcmaScript3 : TypeScript.LanguageVersion.EcmaScript5;

            compilationSettings.moduleGenTarget = moduleType === 'none' ? TypeScript.ModuleGenTarget.Unspecified : (moduleType === 'amd' ? TypeScript.ModuleGenTarget.Asynchronous : TypeScript.ModuleGenTarget.Synchronous);

            this.languageServiceHost = new language.LanguageServiceHost(compilationSettings, this.getFiles());
            if (!compilationSettings.noLib) {
                this.addDefaultLibrary();
            }
            this.languageService = new Services.TypeScriptServicesFactory().createPullLanguageService(this.languageServiceHost);
        };

        TypeScriptProject.prototype.addDefaultLibrary = function () {
            this.addFile(utils.DEFAULT_LIB_LOCATION);
        };
        return TypeScriptProject;
    })();
    exports.TypeScriptProject = TypeScriptProject;
});

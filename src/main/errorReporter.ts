//   Copyright 2013-2014 François de Campredon
//
//   Licensed under the Apache License, Version 2.0 (the "License");
//   you may not use this file except in compliance with the License.
//   You may obtain a copy of the License at
//
//       http://www.apache.org/licenses/LICENSE-2.0
//
//   Unless required by applicable law or agreed to in writing, software
//   distributed under the License is distributed on an "AS IS" BASIS,
//   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//   See the License for the specific language governing permissions and
//   limitations under the License.

'use strict';

//TODO that part of the application is not well tested and just 'work' it needs to be refactored

import ServiceConsumer = require('./serviceConsumer');
import immediate = require('./immediate');


//--------------------------------------------------------------------------
//
//  TypeScriptProject
//
//--------------------------------------------------------------------------

/**
 * TypeScript Inspection Provider
 */
    
/**
 * name of the error reporter
 */
export var name = 'TypeScript';
    
    /**
     * scan file
     */
export function scanFileAsync(content: string, path: string): JQueryPromise<{ errors: brackets.LintingError[];  aborted: boolean }> {
    return $.Deferred(deferred => {
        immediate.setImmediate(() => {
            ServiceConsumer.getService().then(service => {
                service.getErrorsForFile(path).then(
                    result => {
                        deferred.resolve({
                            errors: result,
                            aborted: false
                        });
                    }, () => {
                        deferred.resolve({ 
                            errors: [], 
                            aborted : false
                        });
                    }
                );
            });    
        });
    }).promise();
}


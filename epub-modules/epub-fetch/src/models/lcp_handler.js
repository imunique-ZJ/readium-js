//  Copyright (c) 2014 Readium Foundation and/or its licensees. All rights reserved.
//  
//  Redistribution and use in source and binary forms, with or without modification, 
//  are permitted provided that the following conditions are met:
//  1. Redistributions of source code must retain the above copyright notice, this 
//  list of conditions and the following disclaimer.
//  2. Redistributions in binary form must reproduce the above copyright notice, 
//  this list of conditions and the following disclaimer in the documentation and/or 
//  other materials provided with the distribution.
//  3. Neither the name of the organization nor the names of its contributors may be 
//  used to endorse or promote products derived from this software without specific 
//  prior written permission.

define(['forge', 'promise'], function (forge, es6Promise) {

    var READIUM_LCP_PROFILE_1_0 = 'http://readium.org/lcp/profile-1.0';

    es6Promise.polyfill();

    var LcpHandler = function (encryptionInfos) {

        // private vars
        var userKey = forge.util.hexToBytes(encryptionInfos.hash), contentKey;


        // LCP step by step verifiction functions

        function checkUserKey(license) {
            return new Promise(function (resolve, reject) {
                var userKeyCheck = license.encryption.user_key.key_check;

                // Decrypt and compare it to license ID
                decipher(userKey, atob(userKeyCheck)).then(function (userKeyCheckDecrypted) {
                    if (license.id === userKeyCheckDecrypted.data) {
                        console.info("User key is valid");
                        resolve();
                    } else {
                        reject(Error("User key is invalid"));
                    }
                });
            });
        }

        function checkLicenseFields(license) {
            return new Promise(function (resolve, reject) {
                // mandatory fields
                if (!license.id) {
                    reject(Error("License must contain id"));
                }

                if (!license.issued) {
                    reject(Error("License must contain 'issued'"));
                }

                if (!license.provider) {
                    reject(Error("License must contain 'provider'"));
                }

                if (!license.encryption) {
                    reject(Error("License must contain 'encryption'"));
                }

                if (!license.encryption.profile) {
                    reject(Error("License must contain 'encryption/profile'"));
                }

                if (!license.encryption.content_key) {
                    reject(Error("License must contain 'encryption/content_key'"));
                }

                if (!license.encryption.content_key.algorithm) {
                    reject(Error("License must contain 'encryption/content_key/algorithm'"));
                }

                if (!license.encryption.content_key.encrypted_value) {
                    reject(Error("License must contain 'encryption/content_key/encrypted_value'"));
                }

                if (!license.encryption.user_key) {
                    reject(Error("License must contain 'encryption/user_key'"));
                }

                if (!license.encryption.user_key.algorithm) {
                    reject(Error("License must contain 'encryption/user_key/algorithm'"));
                }

                if (!license.encryption.user_key.key_check) {
                    reject(Error("License must contain 'encryption/user_key/key_check'"));
                }

                if (!license.encryption.user_key.text_hint) {
                    reject(Error("License must contain 'encryption/user_key/text_hint'"));
                }

                if (!license.links) {
                    reject(Error("License must contain 'links'"));
                }

                if (!license.signature) {
                    reject(Error("License must contain 'signature'"));
                }

                if (!license.signature.algorithm) {
                    reject(Error("License must contain 'signature/algorithm'"));
                }

                if (!license.signature.certificate) {
                    reject(Error("License must contain 'signature/certificate'"));
                }

                if (!license.signature.value) {
                    reject(Error("License must contain 'signature/'value"));
                }

                // encryption profile
                if (license.encryption.profile !== READIUM_LCP_PROFILE_1_0) {
                    reject(Error("Unknown encryption profile '" + license.encryption.profile + "'"));
                }

                // rights dates
                if (license.rights.start) {
                    var rightsStart = new Date(license.rights.start);
                    if (rightsStart.getTime() < Date.now()) {
                        reject(Error("License rights begins after now"));
                    }
                }

                if (license.rights.end) {
                    var rightsEnd = new Date(license.rights.end);
                    if (rightsEnd.getTime() > Date.now()) {
                        reject(Error("License rights ends before now"));
                    }
                }

                resolve();
            });
        }

        function checkLicenseCertificate(license, certificate) {
            return new Promise(function (resolve, reject) {
                var notBefore = new Date(certificate.validity.notBefore),
                    notAfter = new Date(certificate.validity.notAfter),
                    licenseUpdated = new Date(license.updated || license.issued);

                if (licenseUpdated.getTime() < notBefore.getTime()) {
                    reject('License issued/updated before the certificate became valid');
                }
                if (licenseUpdated.getTime() > notAfter.getTime()) {
                    reject('License issued/updated after the certificate became valid');
                }

                var licenseNoSignature = JSON.parse(JSON.stringify(license));
                delete licenseNoSignature.signature;
                var md = forge.md.sha256.create();
                md.update(jsonStringify(licenseNoSignature));

                if (!certificate.publicKey.verify(md.digest().bytes(), atob(license.signature.value))) {
                    reject('Invalid Signature');
                }

                console.info("Signature is valid");

                resolve();
            });
        }

        function getContentKey(license) {
            return new Promise(function (resolve) {
                var contentKeyEncrypted = atob(license.encryption.content_key.encrypted_value);
                decipher(userKey, contentKeyEncrypted).then(function (contentKeyDeciphered) {
                    resolve(contentKeyDeciphered.data);
                })
            });
        }

        function decipher(key, encryptedData, dataType) {
            if (dataType === "arraybuffer") {
                return aesDecipher(key, arrayBuffer2Binary(encryptedData));
            }
            if (dataType === "blob") {
                return blobToArrayBuffer(encryptedData).then(function (arrayBuffer) {
                    return aesDecipher(key, arrayBuffer2Binary(arrayBuffer));
                });
            }
            return aesDecipher(key, encryptedData);
        }

        function aesDecipher(key, encryptedData) {
            return new Promise(function (resolve) {
                var aesCipher = forge.cipher.createDecipher('AES-CBC', key);

                aesCipher.start({ iv: encryptedData.substring(0, 16) });
                aesCipher.update(forge.util.createBuffer(encryptedData.substring(16)));
                aesCipher.finish();

                resolve(aesCipher.output);
            });
        }

        // Utility functions

        function arrayBuffer2Binary(buffer) {
            var binary = '';
            var bytes = new Uint8Array(buffer);
            var len = bytes.byteLength;
            for (var i = 0; i < len; i++) {
                binary += String.fromCharCode(bytes[i]);
            }
            return binary;
        }

        function binary2BinArray(binary) {
            var uint8Array = new Uint8Array(binary.length);
            for (var i = 0; i < uint8Array.length; i++) {
                uint8Array[i] = binary.charCodeAt(i);
            }
            return uint8Array;
        }

        function jsonStringify(object) {
            var string = ["{"];

            var keys = [];
            for (var i in object) {
                keys.push(i);
            }
            keys.sort();

            for (var k = 0; k < keys.length; k++) {
                var key = keys[k];
                string.push('"' + key + '":');
                var value = object[key];
                if (value instanceof Object) {
                    string.push(jsonStringify(value));
                } else if (typeof value === 'number' || typeof value === 'boolean') {
                    string.push(value);
                } else {
                    string.push('"' + value + '"');
                }
                if (k < keys.length - 1) {
                    string.push(',');
                }
            }

            string.push("}");

            return string.join("");
        }

        function blobToArrayBuffer(blob) {
            return new Promise(function (resolve, reject) {
                var fileReader = new FileReader();
                fileReader.onload = function () {
                    resolve(this.result);
                };
                fileReader.onerror = reject;
                fileReader.readAsArrayBuffer(blob);
            });
        }

        function getTypeOfData(data) {
            if (data instanceof Blob) {
                return "blob";
            }
            if (data instanceof ArrayBuffer) {
                return "arraybuffer";
            }
            return "binary";
        }

        // PUBLIC API

        this.checkLicense = function (license, callback, error) {
            checkUserKey(license).then(function () {
                return checkLicenseFields(license);
            }).then(function () {
                return checkLicenseCertificate(license, forge.pki.certificateFromAsn1(forge.asn1.fromDer(atob(license.signature.certificate))));
            }).then(function () {
                console.info("License is valid");
                return new getContentKey(license);
            }).then(function (bookContentKey) {
                contentKey = bookContentKey;
                callback();
            }).catch(error);
        };

        this.decryptContent = function (encryptedAes256cbcContent, callback, fetchMode, mimeType) {
            var dataType = getTypeOfData(encryptedAes256cbcContent), data;

            decipher(contentKey, encryptedAes256cbcContent, dataType).then(function (decryptedBinaryData) {
                if (fetchMode === 'text') {
                    // convert UTF-8 decoded data to UTF-16 javascript string (with BOM removal)
                    data = decryptedBinaryData.data.replace(/^ï»¿/, '');
                    if (/html/.test(mimeType)) {
                        data = forge.util.decodeUtf8(data);
                    }
                    callback(data);
                } else if (fetchMode === 'data64') {
                    // convert into a data64 string
                    callback(forge.util.encode64(decryptedBinaryData.data));
                } else {
                    // convert into a blob
                    callback(new Blob([binary2BinArray(decryptedBinaryData.data).buffer], { type: mimeType }));
                }
            }).catch(function (error) {
                console.error("Can't decrypt LCP content", error);
            });
        };
    };

    return LcpHandler;
});
# Appendix A: JSON Schemas

<!-- GENERATED FILE - DO NOT EDIT. Regenerate with `bun run spec:generate` (in olos/), source: olos/scripts/write-spec-schemas.ts -->

This appendix is generated from the `OLOS_JSON_SCHEMAS` export of
`olos/src/schema.ts` (published as `@arsenstorm/olos/schema`) and the
`OLOS_MEDIA_JSON_SCHEMAS` export of `olos/src/media.ts` (published as
`@arsenstorm/olos/media`). Each section reproduces one JSON Schema
verbatim, keyed by its document name.

## A.1 Core wire objects

Profile data (`profile` fields) is an opaque JSON object in every Core
schema; the profile schemas in A.2 constrain its contents.

### `commit`

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "additionalProperties": false,
  "properties": {
    "byterange": {
      "additionalProperties": false,
      "properties": {
        "length": {
          "exclusiveMinimum": 0,
          "type": "integer"
        },
        "offset": {
          "minimum": 0,
          "type": "integer"
        },
        "segmentDeliveryUrl": {
          "minLength": 1,
          "pattern": "^(?:(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)/[^?#]+|https?://[^/?#]+(?:/(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)[^?#]*)?)$",
          "type": "string"
        },
        "segmentObjectKey": {
          "minLength": 1,
          "pattern": "^(?!/)(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)(?!.*[?#]).*[^/]$",
          "type": "string"
        }
      },
      "required": [
        "length",
        "offset",
        "segmentDeliveryUrl",
        "segmentObjectKey"
      ],
      "type": "object"
    },
    "commitId": {
      "minLength": 1,
      "pattern": "^[A-Za-z0-9._-]+$",
      "type": "string"
    },
    "committedAt": {
      "format": "date-time",
      "pattern": "^(\\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])[Tt](?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:[Zz]|[+-](?:[01]\\d|2[0-3]):[0-5]\\d)$",
      "type": "string"
    },
    "deliveryUrl": {
      "minLength": 1,
      "pattern": "^(?:(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)/[^?#]+|https?://[^/?#]+(?:/(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)[^?#]*)?)$",
      "type": "string"
    },
    "epoch": {
      "minimum": 0,
      "type": "integer"
    },
    "etag": {
      "minLength": 1,
      "type": "string"
    },
    "objectKey": {
      "minLength": 1,
      "pattern": "^(?!/)(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)(?!.*[?#]).*[^/]$",
      "type": "string"
    },
    "partNumber": {
      "minimum": 0,
      "type": "integer"
    },
    "profile": {
      "type": "object"
    },
    "sequenceNumber": {
      "minimum": 0,
      "type": "integer"
    },
    "sessionId": {
      "minLength": 1,
      "pattern": "^[A-Za-z0-9._-]+$",
      "type": "string"
    },
    "size": {
      "exclusiveMinimum": 0,
      "type": "integer"
    },
    "slotId": {
      "minLength": 1,
      "pattern": "^[A-Za-z0-9._-]+$",
      "type": "string"
    },
    "trackId": {
      "minLength": 1,
      "pattern": "^[A-Za-z0-9._-]+$",
      "type": "string"
    }
  },
  "required": [
    "commitId",
    "committedAt",
    "deliveryUrl",
    "epoch",
    "objectKey",
    "sequenceNumber",
    "sessionId",
    "size",
    "slotId",
    "trackId"
  ],
  "title": "OLOS Commit",
  "type": "object"
}
```

### `committedWindow`

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "additionalProperties": false,
  "properties": {
    "epoch": {
      "minimum": 0,
      "type": "integer"
    },
    "firstSequenceNumber": {
      "minimum": 0,
      "type": "integer"
    },
    "lastSequenceNumber": {
      "minimum": 0,
      "type": "integer"
    },
    "tracks": {
      "additionalProperties": {
        "additionalProperties": false,
        "properties": {
          "init": {
            "additionalProperties": false,
            "properties": {
              "commitId": {
                "minLength": 1,
                "pattern": "^[A-Za-z0-9._-]+$",
                "type": "string"
              },
              "contentType": {
                "pattern": "^[!#$%&'*+\\-.^_`|~0-9A-Za-z]+/[!#$%&'*+\\-.^_`|~0-9A-Za-z]+(?:; *[!#$%&'*+\\-.^_`|~0-9A-Za-z]+=(?:[!#$%&'*+\\-.^_`|~0-9A-Za-z]+|\"[\\t !#-\\[\\]-~]*\"))*$",
                "type": "string"
              },
              "deliveryUrl": {
                "minLength": 1,
                "pattern": "^(?:(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)/[^?#]+|https?://[^/?#]+(?:/(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)[^?#]*)?)$",
                "type": "string"
              },
              "etag": {
                "minLength": 1,
                "type": "string"
              },
              "objectKey": {
                "minLength": 1,
                "pattern": "^(?!/)(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)(?!.*[?#]).*[^/]$",
                "type": "string"
              },
              "profile": {
                "type": "object"
              },
              "slotId": {
                "minLength": 1,
                "pattern": "^[A-Za-z0-9._-]+$",
                "type": "string"
              }
            },
            "required": [
              "commitId",
              "deliveryUrl",
              "objectKey",
              "slotId"
            ],
            "type": "object"
          },
          "profile": {
            "type": "object"
          },
          "segments": {
            "items": {
              "additionalProperties": false,
              "properties": {
                "parts": {
                  "items": {
                    "additionalProperties": false,
                    "properties": {
                      "commitId": {
                        "minLength": 1,
                        "pattern": "^[A-Za-z0-9._-]+$",
                        "type": "string"
                      },
                      "contentType": {
                        "pattern": "^[!#$%&'*+\\-.^_`|~0-9A-Za-z]+/[!#$%&'*+\\-.^_`|~0-9A-Za-z]+(?:; *[!#$%&'*+\\-.^_`|~0-9A-Za-z]+=(?:[!#$%&'*+\\-.^_`|~0-9A-Za-z]+|\"[\\t !#-\\[\\]-~]*\"))*$",
                        "type": "string"
                      },
                      "deliveryUrl": {
                        "minLength": 1,
                        "pattern": "^(?:(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)/[^?#]+|https?://[^/?#]+(?:/(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)[^?#]*)?)$",
                        "type": "string"
                      },
                      "etag": {
                        "minLength": 1,
                        "type": "string"
                      },
                      "objectKey": {
                        "minLength": 1,
                        "pattern": "^(?!/)(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)(?!.*[?#]).*[^/]$",
                        "type": "string"
                      },
                      "profile": {
                        "type": "object"
                      },
                      "slotId": {
                        "minLength": 1,
                        "pattern": "^[A-Za-z0-9._-]+$",
                        "type": "string"
                      },
                      "byterange": {
                        "additionalProperties": false,
                        "properties": {
                          "length": {
                            "exclusiveMinimum": 0,
                            "type": "integer"
                          },
                          "offset": {
                            "minimum": 0,
                            "type": "integer"
                          },
                          "segmentDeliveryUrl": {
                            "minLength": 1,
                            "pattern": "^(?:(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)/[^?#]+|https?://[^/?#]+(?:/(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)[^?#]*)?)$",
                            "type": "string"
                          },
                          "segmentObjectKey": {
                            "minLength": 1,
                            "pattern": "^(?!/)(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)(?!.*[?#]).*[^/]$",
                            "type": "string"
                          }
                        },
                        "required": [
                          "length",
                          "offset",
                          "segmentDeliveryUrl",
                          "segmentObjectKey"
                        ],
                        "type": "object"
                      },
                      "partNumber": {
                        "minimum": 0,
                        "type": "integer"
                      }
                    },
                    "required": [
                      "commitId",
                      "deliveryUrl",
                      "objectKey",
                      "slotId",
                      "partNumber"
                    ],
                    "type": "object"
                  },
                  "type": "array"
                },
                "segment": {
                  "additionalProperties": false,
                  "properties": {
                    "commitId": {
                      "minLength": 1,
                      "pattern": "^[A-Za-z0-9._-]+$",
                      "type": "string"
                    },
                    "contentType": {
                      "pattern": "^[!#$%&'*+\\-.^_`|~0-9A-Za-z]+/[!#$%&'*+\\-.^_`|~0-9A-Za-z]+(?:; *[!#$%&'*+\\-.^_`|~0-9A-Za-z]+=(?:[!#$%&'*+\\-.^_`|~0-9A-Za-z]+|\"[\\t !#-\\[\\]-~]*\"))*$",
                      "type": "string"
                    },
                    "deliveryUrl": {
                      "minLength": 1,
                      "pattern": "^(?:(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)/[^?#]+|https?://[^/?#]+(?:/(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)[^?#]*)?)$",
                      "type": "string"
                    },
                    "etag": {
                      "minLength": 1,
                      "type": "string"
                    },
                    "objectKey": {
                      "minLength": 1,
                      "pattern": "^(?!/)(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)(?!.*[?#]).*[^/]$",
                      "type": "string"
                    },
                    "profile": {
                      "type": "object"
                    },
                    "slotId": {
                      "minLength": 1,
                      "pattern": "^[A-Za-z0-9._-]+$",
                      "type": "string"
                    }
                  },
                  "required": [
                    "commitId",
                    "deliveryUrl",
                    "objectKey",
                    "slotId"
                  ],
                  "type": "object"
                },
                "sequenceNumber": {
                  "minimum": 0,
                  "type": "integer"
                }
              },
              "required": [
                "sequenceNumber"
              ],
              "type": "object"
            },
            "type": "array"
          },
          "trackId": {
            "minLength": 1,
            "pattern": "^[A-Za-z0-9._-]+$",
            "type": "string"
          }
        },
        "required": [
          "segments",
          "trackId"
        ],
        "type": "object"
      },
      "type": "object"
    }
  },
  "required": [
    "epoch",
    "firstSequenceNumber",
    "lastSequenceNumber",
    "tracks"
  ],
  "title": "OLOS CommittedWindow",
  "type": "object"
}
```

### `cursor`

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "additionalProperties": false,
  "properties": {
    "committedWindow": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "additionalProperties": false,
      "properties": {
        "epoch": {
          "minimum": 0,
          "type": "integer"
        },
        "firstSequenceNumber": {
          "minimum": 0,
          "type": "integer"
        },
        "lastSequenceNumber": {
          "minimum": 0,
          "type": "integer"
        },
        "tracks": {
          "additionalProperties": {
            "additionalProperties": false,
            "properties": {
              "init": {
                "additionalProperties": false,
                "properties": {
                  "commitId": {
                    "minLength": 1,
                    "pattern": "^[A-Za-z0-9._-]+$",
                    "type": "string"
                  },
                  "contentType": {
                    "pattern": "^[!#$%&'*+\\-.^_`|~0-9A-Za-z]+/[!#$%&'*+\\-.^_`|~0-9A-Za-z]+(?:; *[!#$%&'*+\\-.^_`|~0-9A-Za-z]+=(?:[!#$%&'*+\\-.^_`|~0-9A-Za-z]+|\"[\\t !#-\\[\\]-~]*\"))*$",
                    "type": "string"
                  },
                  "deliveryUrl": {
                    "minLength": 1,
                    "pattern": "^(?:(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)/[^?#]+|https?://[^/?#]+(?:/(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)[^?#]*)?)$",
                    "type": "string"
                  },
                  "etag": {
                    "minLength": 1,
                    "type": "string"
                  },
                  "objectKey": {
                    "minLength": 1,
                    "pattern": "^(?!/)(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)(?!.*[?#]).*[^/]$",
                    "type": "string"
                  },
                  "profile": {
                    "type": "object"
                  },
                  "slotId": {
                    "minLength": 1,
                    "pattern": "^[A-Za-z0-9._-]+$",
                    "type": "string"
                  }
                },
                "required": [
                  "commitId",
                  "deliveryUrl",
                  "objectKey",
                  "slotId"
                ],
                "type": "object"
              },
              "profile": {
                "type": "object"
              },
              "segments": {
                "items": {
                  "additionalProperties": false,
                  "properties": {
                    "parts": {
                      "items": {
                        "additionalProperties": false,
                        "properties": {
                          "commitId": {
                            "minLength": 1,
                            "pattern": "^[A-Za-z0-9._-]+$",
                            "type": "string"
                          },
                          "contentType": {
                            "pattern": "^[!#$%&'*+\\-.^_`|~0-9A-Za-z]+/[!#$%&'*+\\-.^_`|~0-9A-Za-z]+(?:; *[!#$%&'*+\\-.^_`|~0-9A-Za-z]+=(?:[!#$%&'*+\\-.^_`|~0-9A-Za-z]+|\"[\\t !#-\\[\\]-~]*\"))*$",
                            "type": "string"
                          },
                          "deliveryUrl": {
                            "minLength": 1,
                            "pattern": "^(?:(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)/[^?#]+|https?://[^/?#]+(?:/(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)[^?#]*)?)$",
                            "type": "string"
                          },
                          "etag": {
                            "minLength": 1,
                            "type": "string"
                          },
                          "objectKey": {
                            "minLength": 1,
                            "pattern": "^(?!/)(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)(?!.*[?#]).*[^/]$",
                            "type": "string"
                          },
                          "profile": {
                            "type": "object"
                          },
                          "slotId": {
                            "minLength": 1,
                            "pattern": "^[A-Za-z0-9._-]+$",
                            "type": "string"
                          },
                          "byterange": {
                            "additionalProperties": false,
                            "properties": {
                              "length": {
                                "exclusiveMinimum": 0,
                                "type": "integer"
                              },
                              "offset": {
                                "minimum": 0,
                                "type": "integer"
                              },
                              "segmentDeliveryUrl": {
                                "minLength": 1,
                                "pattern": "^(?:(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)/[^?#]+|https?://[^/?#]+(?:/(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)[^?#]*)?)$",
                                "type": "string"
                              },
                              "segmentObjectKey": {
                                "minLength": 1,
                                "pattern": "^(?!/)(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)(?!.*[?#]).*[^/]$",
                                "type": "string"
                              }
                            },
                            "required": [
                              "length",
                              "offset",
                              "segmentDeliveryUrl",
                              "segmentObjectKey"
                            ],
                            "type": "object"
                          },
                          "partNumber": {
                            "minimum": 0,
                            "type": "integer"
                          }
                        },
                        "required": [
                          "commitId",
                          "deliveryUrl",
                          "objectKey",
                          "slotId",
                          "partNumber"
                        ],
                        "type": "object"
                      },
                      "type": "array"
                    },
                    "segment": {
                      "additionalProperties": false,
                      "properties": {
                        "commitId": {
                          "minLength": 1,
                          "pattern": "^[A-Za-z0-9._-]+$",
                          "type": "string"
                        },
                        "contentType": {
                          "pattern": "^[!#$%&'*+\\-.^_`|~0-9A-Za-z]+/[!#$%&'*+\\-.^_`|~0-9A-Za-z]+(?:; *[!#$%&'*+\\-.^_`|~0-9A-Za-z]+=(?:[!#$%&'*+\\-.^_`|~0-9A-Za-z]+|\"[\\t !#-\\[\\]-~]*\"))*$",
                          "type": "string"
                        },
                        "deliveryUrl": {
                          "minLength": 1,
                          "pattern": "^(?:(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)/[^?#]+|https?://[^/?#]+(?:/(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)[^?#]*)?)$",
                          "type": "string"
                        },
                        "etag": {
                          "minLength": 1,
                          "type": "string"
                        },
                        "objectKey": {
                          "minLength": 1,
                          "pattern": "^(?!/)(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)(?!.*[?#]).*[^/]$",
                          "type": "string"
                        },
                        "profile": {
                          "type": "object"
                        },
                        "slotId": {
                          "minLength": 1,
                          "pattern": "^[A-Za-z0-9._-]+$",
                          "type": "string"
                        }
                      },
                      "required": [
                        "commitId",
                        "deliveryUrl",
                        "objectKey",
                        "slotId"
                      ],
                      "type": "object"
                    },
                    "sequenceNumber": {
                      "minimum": 0,
                      "type": "integer"
                    }
                  },
                  "required": [
                    "sequenceNumber"
                  ],
                  "type": "object"
                },
                "type": "array"
              },
              "trackId": {
                "minLength": 1,
                "pattern": "^[A-Za-z0-9._-]+$",
                "type": "string"
              }
            },
            "required": [
              "segments",
              "trackId"
            ],
            "type": "object"
          },
          "type": "object"
        }
      },
      "required": [
        "epoch",
        "firstSequenceNumber",
        "lastSequenceNumber",
        "tracks"
      ],
      "title": "OLOS CommittedWindow",
      "type": "object"
    },
    "deliveryBaseUrl": {
      "minLength": 1,
      "pattern": "^(?:(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)/[^?#]+|https?://[^/?#]+(?:/(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)[^?#]*)?)$",
      "type": "string"
    },
    "epoch": {
      "minimum": 0,
      "type": "integer"
    },
    "olos": {
      "const": "1.0"
    },
    "profile": {
      "properties": {
        "id": {
          "minLength": 1,
          "type": "string"
        }
      },
      "required": [
        "id"
      ],
      "type": "object"
    },
    "sessionId": {
      "minLength": 1,
      "pattern": "^[A-Za-z0-9._-]+$",
      "type": "string"
    },
    "state": {
      "enum": [
        "live",
        "ending",
        "ended",
        "aborted"
      ],
      "type": "string"
    },
    "updatedAt": {
      "format": "date-time",
      "pattern": "^(\\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])[Tt](?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:[Zz]|[+-](?:[01]\\d|2[0-3]):[0-5]\\d)$",
      "type": "string"
    },
    "window": {
      "additionalProperties": false,
      "properties": {
        "firstSequenceNumber": {
          "minimum": 0,
          "type": "integer"
        },
        "lastPartNumber": {
          "minimum": 0,
          "type": "integer"
        },
        "lastSequenceNumber": {
          "minimum": 0,
          "type": "integer"
        }
      },
      "required": [
        "firstSequenceNumber",
        "lastSequenceNumber"
      ],
      "type": "object"
    }
  },
  "required": [
    "committedWindow",
    "deliveryBaseUrl",
    "epoch",
    "olos",
    "profile",
    "sessionId",
    "state",
    "updatedAt",
    "window"
  ],
  "title": "OLOS Cursor",
  "type": "object"
}
```

### `error`

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "additionalProperties": false,
  "properties": {
    "error": {
      "additionalProperties": false,
      "properties": {
        "code": {
          "enum": [
            "olos.invalid_session",
            "olos.invalid_state",
            "olos.unknown_slot",
            "olos.slot_expired",
            "olos.key_mismatch",
            "olos.content_type_mismatch",
            "olos.object_too_large",
            "olos.object_too_small",
            "olos.duplicate_commit_conflict",
            "olos.cursor_regression",
            "olos.provider_unavailable",
            "olos.quota_exceeded",
            "olos.security_policy_violation",
            "olos.invalid_request",
            "olos.not_found",
            "olos.method_not_allowed",
            "olos.conflict",
            "olos.internal"
          ],
          "type": "string"
        },
        "details": {
          "type": "object"
        },
        "message": {
          "minLength": 1,
          "type": "string"
        }
      },
      "required": [
        "code",
        "message"
      ],
      "type": "object"
    }
  },
  "required": [
    "error"
  ],
  "title": "OLOS Error",
  "type": "object"
}
```

### `providerCapability`

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "additionalProperties": false,
  "allOf": [
    {
      "if": {
        "properties": {
          "publication": {
            "properties": {
              "directObjectPublication": {
                "const": true
              }
            },
            "required": [
              "directObjectPublication"
            ]
          }
        }
      },
      "then": {
        "properties": {
          "consistency": {
            "properties": {
              "observeAfterCreate": {
                "const": "strong"
              }
            },
            "required": [
              "observeAfterCreate"
            ]
          },
          "delivery": {
            "properties": {
              "negativeCachingPolicyDeclared": {
                "const": true
              }
            },
            "required": [
              "negativeCachingPolicyDeclared"
            ]
          },
          "publication": {
            "properties": {
              "manifestGatedPublication": {
                "const": true
              },
              "overwritesAllowed": {
                "not": {
                  "const": true
                }
              }
            },
            "required": [
              "manifestGatedPublication"
            ]
          }
        }
      }
    }
  ],
  "properties": {
    "api": {
      "additionalProperties": false,
      "properties": {
        "family": {
          "minLength": 1,
          "type": "string"
        }
      },
      "required": [
        "family"
      ],
      "type": "object"
    },
    "consistency": {
      "additionalProperties": false,
      "properties": {
        "listAfterCreate": {
          "enum": [
            "strong",
            "eventual",
            "unknown"
          ],
          "type": "string"
        },
        "observeAfterCreate": {
          "enum": [
            "strong",
            "eventual",
            "unknown"
          ],
          "type": "string"
        },
        "readAfterCreate": {
          "enum": [
            "strong",
            "eventual",
            "unknown"
          ],
          "type": "string"
        }
      },
      "required": [
        "observeAfterCreate",
        "readAfterCreate"
      ],
      "type": "object"
    },
    "delivery": {
      "additionalProperties": false,
      "properties": {
        "documentNavigationCanBeBlocked": {
          "type": "boolean"
        },
        "immutableCaching": {
          "type": "boolean"
        },
        "negativeCachingPolicyDeclared": {
          "type": "boolean"
        },
        "publicBaseUrl": {
          "format": "uri",
          "minLength": 1,
          "pattern": "^https?://[^?#]+$",
          "type": "string"
        },
        "rangeRequests": {
          "type": "boolean"
        }
      },
      "required": [
        "negativeCachingPolicyDeclared",
        "publicBaseUrl"
      ],
      "type": "object"
    },
    "events": {
      "additionalProperties": false,
      "properties": {
        "delivery": {
          "enum": [
            "none",
            "best-effort",
            "at-least-once",
            "exactly-once"
          ],
          "type": "string"
        },
        "objectCreated": {
          "type": "boolean"
        }
      },
      "type": "object"
    },
    "kind": {
      "enum": [
        "object-store"
      ],
      "type": "string"
    },
    "olos": {
      "const": "1.0"
    },
    "providerId": {
      "minLength": 1,
      "pattern": "^[A-Za-z0-9._-]+$",
      "type": "string"
    },
    "publication": {
      "additionalProperties": false,
      "properties": {
        "createIfAbsent": {
          "type": "boolean"
        },
        "directObjectPublication": {
          "type": "boolean"
        },
        "manifestGatedPublication": {
          "type": "boolean"
        },
        "overwritesAllowed": {
          "type": "boolean"
        },
        "privateUploadPublicPromotion": {
          "type": "boolean"
        },
        "readGateAvailable": {
          "type": "boolean"
        }
      },
      "required": [
        "createIfAbsent",
        "directObjectPublication"
      ],
      "type": "object"
    },
    "uploadGrants": {
      "additionalProperties": false,
      "anyOf": [
        {
          "properties": {
            "presignedPut": {
              "const": true
            }
          },
          "required": [
            "presignedPut"
          ]
        },
        {
          "properties": {
            "temporaryCredentials": {
              "const": true
            }
          },
          "required": [
            "temporaryCredentials"
          ]
        }
      ],
      "properties": {
        "contentTypeBound": {
          "type": "boolean"
        },
        "exactKey": {
          "type": "boolean"
        },
        "maxRecommendedTtlSeconds": {
          "exclusiveMinimum": 0,
          "type": "integer"
        },
        "methodBound": {
          "type": "boolean"
        },
        "objectSizeCanBeObserved": {
          "type": "boolean"
        },
        "presignedPut": {
          "type": "boolean"
        },
        "requiredHeadersCanBeSigned": {
          "type": "boolean"
        },
        "temporaryCredentials": {
          "type": "boolean"
        }
      },
      "required": [
        "contentTypeBound",
        "exactKey",
        "methodBound",
        "objectSizeCanBeObserved",
        "requiredHeadersCanBeSigned"
      ],
      "type": "object"
    }
  },
  "required": [
    "consistency",
    "delivery",
    "kind",
    "olos",
    "providerId",
    "publication",
    "uploadGrants"
  ],
  "title": "OLOS ProviderCapabilityDocument",
  "type": "object"
}
```

### `session`

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "additionalProperties": false,
  "properties": {
    "createdAt": {
      "format": "date-time",
      "pattern": "^(\\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])[Tt](?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:[Zz]|[+-](?:[01]\\d|2[0-3]):[0-5]\\d)$",
      "type": "string"
    },
    "epoch": {
      "minimum": 0,
      "type": "integer"
    },
    "olos": {
      "const": "1.0"
    },
    "profile": {
      "properties": {
        "id": {
          "minLength": 1,
          "type": "string"
        }
      },
      "required": [
        "id"
      ],
      "type": "object"
    },
    "sessionId": {
      "minLength": 1,
      "pattern": "^[A-Za-z0-9._-]+$",
      "type": "string"
    },
    "state": {
      "enum": [
        "live",
        "ending",
        "ended",
        "aborted"
      ],
      "type": "string"
    },
    "tracks": {
      "items": {
        "additionalProperties": false,
        "properties": {
          "contentType": {
            "pattern": "^[!#$%&'*+\\-.^_`|~0-9A-Za-z]+/[!#$%&'*+\\-.^_`|~0-9A-Za-z]+(?:; *[!#$%&'*+\\-.^_`|~0-9A-Za-z]+=(?:[!#$%&'*+\\-.^_`|~0-9A-Za-z]+|\"[\\t !#-\\[\\]-~]*\"))*$",
            "type": "string"
          },
          "profile": {
            "type": "object"
          },
          "trackId": {
            "minLength": 1,
            "pattern": "^[A-Za-z0-9._-]+$",
            "type": "string"
          }
        },
        "required": [
          "trackId"
        ],
        "type": "object"
      },
      "minItems": 1,
      "type": "array"
    }
  },
  "required": [
    "createdAt",
    "epoch",
    "olos",
    "profile",
    "sessionId",
    "state",
    "tracks"
  ],
  "title": "OLOS Session",
  "type": "object"
}
```

### `storageObject`

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "additionalProperties": false,
  "properties": {
    "contentType": {
      "pattern": "^[!#$%&'*+\\-.^_`|~0-9A-Za-z]+/[!#$%&'*+\\-.^_`|~0-9A-Za-z]+(?:; *[!#$%&'*+\\-.^_`|~0-9A-Za-z]+=(?:[!#$%&'*+\\-.^_`|~0-9A-Za-z]+|\"[\\t !#-\\[\\]-~]*\"))*$",
      "type": "string"
    },
    "etag": {
      "minLength": 1,
      "type": "string"
    },
    "metadata": {
      "additionalProperties": {
        "type": "string"
      },
      "propertyNames": {
        "pattern": "^[!#$%&'*+\\-.^_`|~0-9A-Za-z]+$"
      },
      "type": "object"
    },
    "objectKey": {
      "minLength": 1,
      "pattern": "^(?!/)(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)(?!.*[?#]).*[^/]$",
      "type": "string"
    },
    "observedAt": {
      "format": "date-time",
      "pattern": "^(\\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])[Tt](?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:[Zz]|[+-](?:[01]\\d|2[0-3]):[0-5]\\d)$",
      "type": "string"
    },
    "providerId": {
      "minLength": 1,
      "pattern": "^[A-Za-z0-9._-]+$",
      "type": "string"
    },
    "size": {
      "exclusiveMinimum": 0,
      "type": "integer"
    }
  },
  "required": [
    "contentType",
    "objectKey",
    "observedAt",
    "providerId",
    "size"
  ],
  "title": "OLOS StorageObject",
  "type": "object"
}
```

### `uploadGrant`

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "additionalProperties": false,
  "properties": {
    "expiresAt": {
      "format": "date-time",
      "pattern": "^(\\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])[Tt](?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:[Zz]|[+-](?:[01]\\d|2[0-3]):[0-5]\\d)$",
      "type": "string"
    },
    "method": {
      "const": "PUT"
    },
    "requiredHeaders": {
      "additionalProperties": {
        "type": "string"
      },
      "propertyNames": {
        "pattern": "^[!#$%&'*+\\-.^_`|~0-9A-Za-z]+$"
      },
      "type": "object"
    },
    "slotId": {
      "minLength": 1,
      "pattern": "^[A-Za-z0-9._-]+$",
      "type": "string"
    },
    "url": {
      "format": "uri",
      "minLength": 1,
      "type": "string"
    }
  },
  "required": [
    "expiresAt",
    "method",
    "slotId",
    "url"
  ],
  "title": "OLOS UploadGrant",
  "type": "object"
}
```

### `uploadSlot`

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "additionalProperties": false,
  "properties": {
    "byterange": {
      "additionalProperties": false,
      "properties": {
        "length": {
          "exclusiveMinimum": 0,
          "type": "integer"
        },
        "offset": {
          "minimum": 0,
          "type": "integer"
        },
        "segmentDeliveryUrl": {
          "minLength": 1,
          "pattern": "^(?:(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)/[^?#]+|https?://[^/?#]+(?:/(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)[^?#]*)?)$",
          "type": "string"
        },
        "segmentObjectKey": {
          "minLength": 1,
          "pattern": "^(?!/)(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)(?!.*[?#]).*[^/]$",
          "type": "string"
        }
      },
      "required": [
        "length",
        "offset",
        "segmentDeliveryUrl",
        "segmentObjectKey"
      ],
      "type": "object"
    },
    "contentType": {
      "pattern": "^[!#$%&'*+\\-.^_`|~0-9A-Za-z]+/[!#$%&'*+\\-.^_`|~0-9A-Za-z]+(?:; *[!#$%&'*+\\-.^_`|~0-9A-Za-z]+=(?:[!#$%&'*+\\-.^_`|~0-9A-Za-z]+|\"[\\t !#-\\[\\]-~]*\"))*$",
      "type": "string"
    },
    "deliveryUrl": {
      "minLength": 1,
      "pattern": "^(?:(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)/[^?#]+|https?://[^/?#]+(?:/(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)[^?#]*)?)$",
      "type": "string"
    },
    "epoch": {
      "minimum": 0,
      "type": "integer"
    },
    "expiresAt": {
      "format": "date-time",
      "pattern": "^(\\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])[Tt](?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:[Zz]|[+-](?:[01]\\d|2[0-3]):[0-5]\\d)$",
      "type": "string"
    },
    "kind": {
      "enum": [
        "init",
        "part",
        "segment"
      ],
      "type": "string"
    },
    "maxBytes": {
      "exclusiveMinimum": 0,
      "type": "integer"
    },
    "minBytes": {
      "minimum": 0,
      "type": "integer"
    },
    "objectKey": {
      "minLength": 1,
      "pattern": "^(?!/)(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)(?!.*[?#]).*[^/]$",
      "type": "string"
    },
    "partNumber": {
      "minimum": 0,
      "type": "integer"
    },
    "profile": {
      "type": "object"
    },
    "sequenceNumber": {
      "minimum": 0,
      "type": "integer"
    },
    "sessionId": {
      "minLength": 1,
      "pattern": "^[A-Za-z0-9._-]+$",
      "type": "string"
    },
    "slotId": {
      "minLength": 1,
      "pattern": "^[A-Za-z0-9._-]+$",
      "type": "string"
    },
    "state": {
      "enum": [
        "issued",
        "upload_observed",
        "committed",
        "expired",
        "rejected",
        "revoked"
      ],
      "type": "string"
    },
    "trackId": {
      "minLength": 1,
      "pattern": "^[A-Za-z0-9._-]+$",
      "type": "string"
    }
  },
  "required": [
    "contentType",
    "deliveryUrl",
    "epoch",
    "expiresAt",
    "kind",
    "maxBytes",
    "objectKey",
    "sequenceNumber",
    "sessionId",
    "slotId",
    "state",
    "trackId"
  ],
  "title": "OLOS UploadSlot",
  "type": "object"
}
```

## A.2 CMAF/LL-HLS profile (`cmaf-llhls`)

Schemas for the `profile` contents of sessions, tracks, slots, commits,
and committed objects under the CMAF/LL-HLS profile (Section 8).

### `mediaObjectProfile`

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "additionalProperties": false,
  "properties": {
    "discontinuityBefore": {
      "type": "boolean"
    },
    "duration": {
      "exclusiveMinimum": 0,
      "type": "number"
    },
    "independent": {
      "type": "boolean"
    },
    "programDateTime": {
      "format": "date-time",
      "pattern": "^(\\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])[Tt](?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:[Zz]|[+-](?:[01]\\d|2[0-3]):[0-5]\\d)$",
      "type": "string"
    }
  },
  "title": "OLOS Media Object Profile",
  "type": "object"
}
```

### `mediaSession`

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "additionalProperties": false,
  "properties": {
    "createdAt": {
      "format": "date-time",
      "pattern": "^(\\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])[Tt](?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:[Zz]|[+-](?:[01]\\d|2[0-3]):[0-5]\\d)$",
      "type": "string"
    },
    "epoch": {
      "minimum": 0,
      "type": "integer"
    },
    "olos": {
      "const": "1.0"
    },
    "profile": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "additionalProperties": false,
      "properties": {
        "discontinuitySequence": {
          "minimum": 0,
          "type": "integer"
        },
        "id": {
          "const": "cmaf-llhls"
        },
        "partTarget": {
          "exclusiveMinimum": 0,
          "type": "number"
        },
        "segmentTarget": {
          "exclusiveMinimum": 0,
          "type": "number"
        }
      },
      "required": [
        "id",
        "partTarget",
        "segmentTarget"
      ],
      "title": "OLOS Media Session Profile",
      "type": "object"
    },
    "sessionId": {
      "minLength": 1,
      "pattern": "^[A-Za-z0-9._-]+$",
      "type": "string"
    },
    "state": {
      "enum": [
        "live",
        "ending",
        "ended",
        "aborted"
      ],
      "type": "string"
    },
    "tracks": {
      "items": {
        "additionalProperties": false,
        "properties": {
          "contentType": {
            "pattern": "^[!#$%&'*+\\-.^_`|~0-9A-Za-z]+/[!#$%&'*+\\-.^_`|~0-9A-Za-z]+(?:; *[!#$%&'*+\\-.^_`|~0-9A-Za-z]+=(?:[!#$%&'*+\\-.^_`|~0-9A-Za-z]+|\"[\\t !#-\\[\\]-~]*\"))*$",
            "type": "string"
          },
          "profile": {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "additionalProperties": false,
            "allOf": [
              {
                "if": {
                  "not": {
                    "properties": {
                      "kind": {
                        "const": "audio"
                      }
                    },
                    "required": [
                      "kind"
                    ]
                  }
                },
                "then": {
                  "properties": {
                    "defaultTrack": false,
                    "groupId": false,
                    "name": false
                  }
                }
              }
            ],
            "dependentRequired": {
              "height": [
                "width"
              ],
              "width": [
                "height"
              ]
            },
            "properties": {
              "bitrate": {
                "exclusiveMinimum": 0,
                "type": "integer"
              },
              "channels": {
                "exclusiveMinimum": 0,
                "type": "integer"
              },
              "codec": {
                "minLength": 1,
                "type": "string"
              },
              "defaultTrack": {
                "type": "boolean"
              },
              "frameRate": {
                "exclusiveMinimum": 0,
                "type": "number"
              },
              "groupId": {
                "minLength": 1,
                "pattern": "^[A-Za-z0-9._-]+$",
                "type": "string"
              },
              "height": {
                "exclusiveMinimum": 0,
                "type": "integer"
              },
              "kind": {
                "enum": [
                  "audio",
                  "video",
                  "text",
                  "metadata"
                ],
                "type": "string"
              },
              "name": {
                "minLength": 1,
                "type": "string"
              },
              "sampleRate": {
                "exclusiveMinimum": 0,
                "type": "integer"
              },
              "width": {
                "exclusiveMinimum": 0,
                "type": "integer"
              }
            },
            "required": [
              "codec",
              "kind"
            ],
            "title": "OLOS Media Track Profile",
            "type": "object"
          },
          "trackId": {
            "minLength": 1,
            "pattern": "^[A-Za-z0-9._-]+$",
            "type": "string"
          }
        },
        "required": [
          "profile",
          "trackId"
        ],
        "type": "object"
      },
      "minItems": 1,
      "type": "array"
    }
  },
  "required": [
    "createdAt",
    "epoch",
    "olos",
    "profile",
    "sessionId",
    "state",
    "tracks"
  ],
  "title": "OLOS Media Session",
  "type": "object"
}
```

### `mediaSessionProfile`

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "additionalProperties": false,
  "properties": {
    "discontinuitySequence": {
      "minimum": 0,
      "type": "integer"
    },
    "id": {
      "const": "cmaf-llhls"
    },
    "partTarget": {
      "exclusiveMinimum": 0,
      "type": "number"
    },
    "segmentTarget": {
      "exclusiveMinimum": 0,
      "type": "number"
    }
  },
  "required": [
    "id",
    "partTarget",
    "segmentTarget"
  ],
  "title": "OLOS Media Session Profile",
  "type": "object"
}
```

### `mediaTrackProfile`

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "additionalProperties": false,
  "allOf": [
    {
      "if": {
        "not": {
          "properties": {
            "kind": {
              "const": "audio"
            }
          },
          "required": [
            "kind"
          ]
        }
      },
      "then": {
        "properties": {
          "defaultTrack": false,
          "groupId": false,
          "name": false
        }
      }
    }
  ],
  "dependentRequired": {
    "height": [
      "width"
    ],
    "width": [
      "height"
    ]
  },
  "properties": {
    "bitrate": {
      "exclusiveMinimum": 0,
      "type": "integer"
    },
    "channels": {
      "exclusiveMinimum": 0,
      "type": "integer"
    },
    "codec": {
      "minLength": 1,
      "type": "string"
    },
    "defaultTrack": {
      "type": "boolean"
    },
    "frameRate": {
      "exclusiveMinimum": 0,
      "type": "number"
    },
    "groupId": {
      "minLength": 1,
      "pattern": "^[A-Za-z0-9._-]+$",
      "type": "string"
    },
    "height": {
      "exclusiveMinimum": 0,
      "type": "integer"
    },
    "kind": {
      "enum": [
        "audio",
        "video",
        "text",
        "metadata"
      ],
      "type": "string"
    },
    "name": {
      "minLength": 1,
      "type": "string"
    },
    "sampleRate": {
      "exclusiveMinimum": 0,
      "type": "integer"
    },
    "width": {
      "exclusiveMinimum": 0,
      "type": "integer"
    }
  },
  "required": [
    "codec",
    "kind"
  ],
  "title": "OLOS Media Track Profile",
  "type": "object"
}
```

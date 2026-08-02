# Appendix A: JSON Schemas

<!-- GENERATED FILE - DO NOT EDIT. Regenerate with `bun run spec:generate` (in olos/), source: olos/scripts/write-spec-schemas.ts -->

This appendix is generated from the `OLOS_JSON_SCHEMAS` export of
`olos/src/schema.ts` (published as `@arsenstorm/olos/schema`). Each
section reproduces one wire-format JSON Schema verbatim, keyed by its
document name.

## `commit`

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
          "pattern": "^(?:(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)/[^?#]+|https?://[^?#]+)$",
          "type": "string"
        },
        "segmentObjectKey": {
          "minLength": 1,
          "pattern": "^(?!/)(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)(?!.*[?#]).+[^/]$",
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
      "pattern": "^[A-Za-z0-9_-]+$",
      "type": "string"
    },
    "committedAt": {
      "format": "date-time",
      "type": "string"
    },
    "deliveryUrl": {
      "minLength": 1,
      "pattern": "^(?:(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)/[^?#]+|https?://[^?#]+)$",
      "type": "string"
    },
    "duration": {
      "exclusiveMinimum": 0,
      "type": "number"
    },
    "epoch": {
      "minimum": 0,
      "type": "integer"
    },
    "etag": {
      "minLength": 1,
      "type": "string"
    },
    "independent": {
      "type": "boolean"
    },
    "mediaSequenceNumber": {
      "minimum": 0,
      "type": "integer"
    },
    "objectKey": {
      "minLength": 1,
      "pattern": "^(?!/)(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)(?!.*[?#]).+[^/]$",
      "type": "string"
    },
    "partNumber": {
      "minimum": 0,
      "type": "integer"
    },
    "programDateTime": {
      "format": "date-time",
      "type": "string"
    },
    "renditionId": {
      "minLength": 1,
      "pattern": "^[A-Za-z0-9_-]+$",
      "type": "string"
    },
    "sessionId": {
      "minLength": 1,
      "pattern": "^[A-Za-z0-9_-]+$",
      "type": "string"
    },
    "size": {
      "exclusiveMinimum": 0,
      "type": "integer"
    },
    "slotId": {
      "minLength": 1,
      "pattern": "^[A-Za-z0-9_-]+$",
      "type": "string"
    }
  },
  "required": [
    "commitId",
    "committedAt",
    "deliveryUrl",
    "duration",
    "epoch",
    "mediaSequenceNumber",
    "objectKey",
    "renditionId",
    "sessionId",
    "size",
    "slotId"
  ],
  "title": "OLOS Commit",
  "type": "object"
}
```

## `committedWindow`

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "additionalProperties": false,
  "properties": {
    "discontinuitySequence": {
      "minimum": 0,
      "type": "integer"
    },
    "epoch": {
      "minimum": 0,
      "type": "integer"
    },
    "firstMediaSequenceNumber": {
      "minimum": 0,
      "type": "integer"
    },
    "lastMediaSequenceNumber": {
      "minimum": 0,
      "type": "integer"
    },
    "renditions": {
      "additionalProperties": {
        "additionalProperties": false,
        "properties": {
          "discontinuitySequence": {
            "minimum": 0,
            "type": "integer"
          },
          "init": {
            "additionalProperties": false,
            "properties": {
              "commitId": {
                "minLength": 1,
                "pattern": "^[A-Za-z0-9_-]+$",
                "type": "string"
              },
              "contentType": {
                "pattern": "^[!#$%&'*+\\-.^_`|~0-9A-Za-z]+/[!#$%&'*+\\-.^_`|~0-9A-Za-z]+(?:; *[!#$%&'*+\\-.^_`|~0-9A-Za-z]+=(?:[!#$%&'*+\\-.^_`|~0-9A-Za-z]+|\"[\\t !#-\\[\\]-~]*\"))*$",
                "type": "string"
              },
              "deliveryUrl": {
                "minLength": 1,
                "pattern": "^(?:(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)/[^?#]+|https?://[^?#]+)$",
                "type": "string"
              },
              "duration": {
                "exclusiveMinimum": 0,
                "type": "number"
              },
              "etag": {
                "minLength": 1,
                "type": "string"
              },
              "objectKey": {
                "minLength": 1,
                "pattern": "^(?!/)(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)(?!.*[?#]).+[^/]$",
                "type": "string"
              },
              "slotId": {
                "minLength": 1,
                "pattern": "^[A-Za-z0-9_-]+$",
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
          "renditionId": {
            "minLength": 1,
            "pattern": "^[A-Za-z0-9_-]+$",
            "type": "string"
          },
          "segments": {
            "items": {
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
                "mediaSequenceNumber": {
                  "minimum": 0,
                  "type": "integer"
                },
                "parts": {
                  "items": {
                    "additionalProperties": false,
                    "properties": {
                      "commitId": {
                        "minLength": 1,
                        "pattern": "^[A-Za-z0-9_-]+$",
                        "type": "string"
                      },
                      "contentType": {
                        "pattern": "^[!#$%&'*+\\-.^_`|~0-9A-Za-z]+/[!#$%&'*+\\-.^_`|~0-9A-Za-z]+(?:; *[!#$%&'*+\\-.^_`|~0-9A-Za-z]+=(?:[!#$%&'*+\\-.^_`|~0-9A-Za-z]+|\"[\\t !#-\\[\\]-~]*\"))*$",
                        "type": "string"
                      },
                      "deliveryUrl": {
                        "minLength": 1,
                        "pattern": "^(?:(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)/[^?#]+|https?://[^?#]+)$",
                        "type": "string"
                      },
                      "duration": {
                        "exclusiveMinimum": 0,
                        "type": "number"
                      },
                      "etag": {
                        "minLength": 1,
                        "type": "string"
                      },
                      "objectKey": {
                        "minLength": 1,
                        "pattern": "^(?!/)(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)(?!.*[?#]).+[^/]$",
                        "type": "string"
                      },
                      "slotId": {
                        "minLength": 1,
                        "pattern": "^[A-Za-z0-9_-]+$",
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
                            "pattern": "^(?:(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)/[^?#]+|https?://[^?#]+)$",
                            "type": "string"
                          },
                          "segmentObjectKey": {
                            "minLength": 1,
                            "pattern": "^(?!/)(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)(?!.*[?#]).+[^/]$",
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
                      "independent": {
                        "type": "boolean"
                      },
                      "partNumber": {
                        "minimum": 0,
                        "type": "integer"
                      },
                      "programDateTime": {
                        "format": "date-time",
                        "type": "string"
                      }
                    },
                    "required": [
                      "commitId",
                      "deliveryUrl",
                      "objectKey",
                      "slotId",
                      "duration",
                      "partNumber"
                    ],
                    "type": "object"
                  },
                  "type": "array"
                },
                "programDateTime": {
                  "format": "date-time",
                  "type": "string"
                },
                "segment": {
                  "additionalProperties": false,
                  "properties": {
                    "commitId": {
                      "minLength": 1,
                      "pattern": "^[A-Za-z0-9_-]+$",
                      "type": "string"
                    },
                    "contentType": {
                      "pattern": "^[!#$%&'*+\\-.^_`|~0-9A-Za-z]+/[!#$%&'*+\\-.^_`|~0-9A-Za-z]+(?:; *[!#$%&'*+\\-.^_`|~0-9A-Za-z]+=(?:[!#$%&'*+\\-.^_`|~0-9A-Za-z]+|\"[\\t !#-\\[\\]-~]*\"))*$",
                      "type": "string"
                    },
                    "deliveryUrl": {
                      "minLength": 1,
                      "pattern": "^(?:(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)/[^?#]+|https?://[^?#]+)$",
                      "type": "string"
                    },
                    "duration": {
                      "exclusiveMinimum": 0,
                      "type": "number"
                    },
                    "etag": {
                      "minLength": 1,
                      "type": "string"
                    },
                    "objectKey": {
                      "minLength": 1,
                      "pattern": "^(?!/)(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)(?!.*[?#]).+[^/]$",
                      "type": "string"
                    },
                    "slotId": {
                      "minLength": 1,
                      "pattern": "^[A-Za-z0-9_-]+$",
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
                }
              },
              "required": [
                "duration",
                "mediaSequenceNumber"
              ],
              "type": "object"
            },
            "type": "array"
          }
        },
        "required": [
          "init",
          "renditionId",
          "segments"
        ],
        "type": "object"
      },
      "type": "object"
    }
  },
  "required": [
    "discontinuitySequence",
    "epoch",
    "firstMediaSequenceNumber",
    "lastMediaSequenceNumber",
    "renditions"
  ],
  "title": "OLOS CommittedWindow",
  "type": "object"
}
```

## `cursor`

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "additionalProperties": false,
  "properties": {
    "committedWindow": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "additionalProperties": false,
      "properties": {
        "discontinuitySequence": {
          "minimum": 0,
          "type": "integer"
        },
        "epoch": {
          "minimum": 0,
          "type": "integer"
        },
        "firstMediaSequenceNumber": {
          "minimum": 0,
          "type": "integer"
        },
        "lastMediaSequenceNumber": {
          "minimum": 0,
          "type": "integer"
        },
        "renditions": {
          "additionalProperties": {
            "additionalProperties": false,
            "properties": {
              "discontinuitySequence": {
                "minimum": 0,
                "type": "integer"
              },
              "init": {
                "additionalProperties": false,
                "properties": {
                  "commitId": {
                    "minLength": 1,
                    "pattern": "^[A-Za-z0-9_-]+$",
                    "type": "string"
                  },
                  "contentType": {
                    "pattern": "^[!#$%&'*+\\-.^_`|~0-9A-Za-z]+/[!#$%&'*+\\-.^_`|~0-9A-Za-z]+(?:; *[!#$%&'*+\\-.^_`|~0-9A-Za-z]+=(?:[!#$%&'*+\\-.^_`|~0-9A-Za-z]+|\"[\\t !#-\\[\\]-~]*\"))*$",
                    "type": "string"
                  },
                  "deliveryUrl": {
                    "minLength": 1,
                    "pattern": "^(?:(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)/[^?#]+|https?://[^?#]+)$",
                    "type": "string"
                  },
                  "duration": {
                    "exclusiveMinimum": 0,
                    "type": "number"
                  },
                  "etag": {
                    "minLength": 1,
                    "type": "string"
                  },
                  "objectKey": {
                    "minLength": 1,
                    "pattern": "^(?!/)(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)(?!.*[?#]).+[^/]$",
                    "type": "string"
                  },
                  "slotId": {
                    "minLength": 1,
                    "pattern": "^[A-Za-z0-9_-]+$",
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
              "renditionId": {
                "minLength": 1,
                "pattern": "^[A-Za-z0-9_-]+$",
                "type": "string"
              },
              "segments": {
                "items": {
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
                    "mediaSequenceNumber": {
                      "minimum": 0,
                      "type": "integer"
                    },
                    "parts": {
                      "items": {
                        "additionalProperties": false,
                        "properties": {
                          "commitId": {
                            "minLength": 1,
                            "pattern": "^[A-Za-z0-9_-]+$",
                            "type": "string"
                          },
                          "contentType": {
                            "pattern": "^[!#$%&'*+\\-.^_`|~0-9A-Za-z]+/[!#$%&'*+\\-.^_`|~0-9A-Za-z]+(?:; *[!#$%&'*+\\-.^_`|~0-9A-Za-z]+=(?:[!#$%&'*+\\-.^_`|~0-9A-Za-z]+|\"[\\t !#-\\[\\]-~]*\"))*$",
                            "type": "string"
                          },
                          "deliveryUrl": {
                            "minLength": 1,
                            "pattern": "^(?:(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)/[^?#]+|https?://[^?#]+)$",
                            "type": "string"
                          },
                          "duration": {
                            "exclusiveMinimum": 0,
                            "type": "number"
                          },
                          "etag": {
                            "minLength": 1,
                            "type": "string"
                          },
                          "objectKey": {
                            "minLength": 1,
                            "pattern": "^(?!/)(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)(?!.*[?#]).+[^/]$",
                            "type": "string"
                          },
                          "slotId": {
                            "minLength": 1,
                            "pattern": "^[A-Za-z0-9_-]+$",
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
                                "pattern": "^(?:(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)/[^?#]+|https?://[^?#]+)$",
                                "type": "string"
                              },
                              "segmentObjectKey": {
                                "minLength": 1,
                                "pattern": "^(?!/)(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)(?!.*[?#]).+[^/]$",
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
                          "independent": {
                            "type": "boolean"
                          },
                          "partNumber": {
                            "minimum": 0,
                            "type": "integer"
                          },
                          "programDateTime": {
                            "format": "date-time",
                            "type": "string"
                          }
                        },
                        "required": [
                          "commitId",
                          "deliveryUrl",
                          "objectKey",
                          "slotId",
                          "duration",
                          "partNumber"
                        ],
                        "type": "object"
                      },
                      "type": "array"
                    },
                    "programDateTime": {
                      "format": "date-time",
                      "type": "string"
                    },
                    "segment": {
                      "additionalProperties": false,
                      "properties": {
                        "commitId": {
                          "minLength": 1,
                          "pattern": "^[A-Za-z0-9_-]+$",
                          "type": "string"
                        },
                        "contentType": {
                          "pattern": "^[!#$%&'*+\\-.^_`|~0-9A-Za-z]+/[!#$%&'*+\\-.^_`|~0-9A-Za-z]+(?:; *[!#$%&'*+\\-.^_`|~0-9A-Za-z]+=(?:[!#$%&'*+\\-.^_`|~0-9A-Za-z]+|\"[\\t !#-\\[\\]-~]*\"))*$",
                          "type": "string"
                        },
                        "deliveryUrl": {
                          "minLength": 1,
                          "pattern": "^(?:(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)/[^?#]+|https?://[^?#]+)$",
                          "type": "string"
                        },
                        "duration": {
                          "exclusiveMinimum": 0,
                          "type": "number"
                        },
                        "etag": {
                          "minLength": 1,
                          "type": "string"
                        },
                        "objectKey": {
                          "minLength": 1,
                          "pattern": "^(?!/)(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)(?!.*[?#]).+[^/]$",
                          "type": "string"
                        },
                        "slotId": {
                          "minLength": 1,
                          "pattern": "^[A-Za-z0-9_-]+$",
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
                    }
                  },
                  "required": [
                    "duration",
                    "mediaSequenceNumber"
                  ],
                  "type": "object"
                },
                "type": "array"
              }
            },
            "required": [
              "init",
              "renditionId",
              "segments"
            ],
            "type": "object"
          },
          "type": "object"
        }
      },
      "required": [
        "discontinuitySequence",
        "epoch",
        "firstMediaSequenceNumber",
        "lastMediaSequenceNumber",
        "renditions"
      ],
      "title": "OLOS CommittedWindow",
      "type": "object"
    },
    "epoch": {
      "minimum": 0,
      "type": "integer"
    },
    "latencyProfile": {
      "enum": [
        "object-ll"
      ],
      "type": "string"
    },
    "mediaBaseUrl": {
      "minLength": 1,
      "pattern": "^(?:(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)/[^?#]+|https?://[^?#]+)$",
      "type": "string"
    },
    "olos": {
      "const": "1.0"
    },
    "partTarget": {
      "exclusiveMinimum": 0,
      "type": "number"
    },
    "segmentTarget": {
      "exclusiveMinimum": 0,
      "type": "number"
    },
    "sessionId": {
      "minLength": 1,
      "pattern": "^[A-Za-z0-9_-]+$",
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
      "type": "string"
    },
    "window": {
      "additionalProperties": false,
      "properties": {
        "firstMediaSequenceNumber": {
          "minimum": 0,
          "type": "integer"
        },
        "lastMediaSequenceNumber": {
          "minimum": 0,
          "type": "integer"
        },
        "lastPartNumber": {
          "minimum": 0,
          "type": "integer"
        }
      },
      "required": [
        "firstMediaSequenceNumber",
        "lastMediaSequenceNumber"
      ],
      "type": "object"
    }
  },
  "required": [
    "committedWindow",
    "epoch",
    "latencyProfile",
    "mediaBaseUrl",
    "olos",
    "partTarget",
    "segmentTarget",
    "sessionId",
    "state",
    "updatedAt",
    "window"
  ],
  "title": "OLOS Cursor",
  "type": "object"
}
```

## `error`

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
            "olos.conflict"
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

## `mediaObject`

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
    "objectKey": {
      "minLength": 1,
      "pattern": "^(?!/)(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)(?!.*[?#]).+[^/]$",
      "type": "string"
    },
    "observedAt": {
      "format": "date-time",
      "type": "string"
    },
    "providerId": {
      "minLength": 1,
      "pattern": "^[A-Za-z0-9_-]+$",
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
  "title": "OLOS MediaObject",
  "type": "object"
}
```

## `providerCapability`

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
              "headAfterCreate": {
                "const": "strong"
              }
            },
            "required": [
              "headAfterCreate"
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
        "headAfterCreate": {
          "enum": [
            "strong",
            "eventual",
            "unknown"
          ],
          "type": "string"
        },
        "listAfterCreate": {
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
        "headAfterCreate",
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
      "pattern": "^[A-Za-z0-9_-]+$",
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

## `session`

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "additionalProperties": false,
  "properties": {
    "createdAt": {
      "format": "date-time",
      "type": "string"
    },
    "epoch": {
      "minimum": 0,
      "type": "integer"
    },
    "latencyProfile": {
      "enum": [
        "object-ll"
      ],
      "type": "string"
    },
    "olos": {
      "const": "1.0"
    },
    "partTarget": {
      "exclusiveMinimum": 0,
      "type": "number"
    },
    "renditions": {
      "items": {
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
                "defaultRendition": false,
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
          "defaultRendition": {
            "type": "boolean"
          },
          "frameRate": {
            "exclusiveMinimum": 0,
            "type": "number"
          },
          "groupId": {
            "minLength": 1,
            "pattern": "^[A-Za-z0-9_-]+$",
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
          "renditionId": {
            "minLength": 1,
            "pattern": "^[A-Za-z0-9_-]+$",
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
          "kind",
          "renditionId"
        ],
        "type": "object"
      },
      "minItems": 1,
      "type": "array"
    },
    "segmentTarget": {
      "exclusiveMinimum": 0,
      "type": "number"
    },
    "sessionId": {
      "minLength": 1,
      "pattern": "^[A-Za-z0-9_-]+$",
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
    }
  },
  "required": [
    "createdAt",
    "epoch",
    "latencyProfile",
    "olos",
    "partTarget",
    "renditions",
    "segmentTarget",
    "sessionId",
    "state"
  ],
  "title": "OLOS Session",
  "type": "object"
}
```

## `uploadGrant`

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "additionalProperties": false,
  "properties": {
    "expiresAt": {
      "format": "date-time",
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
      "pattern": "^[A-Za-z0-9_-]+$",
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

## `uploadSlot`

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
          "pattern": "^(?:(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)/[^?#]+|https?://[^?#]+)$",
          "type": "string"
        },
        "segmentObjectKey": {
          "minLength": 1,
          "pattern": "^(?!/)(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)(?!.*[?#]).+[^/]$",
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
      "pattern": "^(?:(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)/[^?#]+|https?://[^?#]+)$",
      "type": "string"
    },
    "duration": {
      "exclusiveMinimum": 0,
      "type": "number"
    },
    "epoch": {
      "minimum": 0,
      "type": "integer"
    },
    "expiresAt": {
      "format": "date-time",
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
    "mediaSequenceNumber": {
      "minimum": 0,
      "type": "integer"
    },
    "minBytes": {
      "minimum": 0,
      "type": "integer"
    },
    "objectKey": {
      "minLength": 1,
      "pattern": "^(?!/)(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)(?!.*[?#]).+[^/]$",
      "type": "string"
    },
    "partNumber": {
      "minimum": 0,
      "type": "integer"
    },
    "renditionId": {
      "minLength": 1,
      "pattern": "^[A-Za-z0-9_-]+$",
      "type": "string"
    },
    "sessionId": {
      "minLength": 1,
      "pattern": "^[A-Za-z0-9_-]+$",
      "type": "string"
    },
    "slotId": {
      "minLength": 1,
      "pattern": "^[A-Za-z0-9_-]+$",
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
    }
  },
  "required": [
    "contentType",
    "deliveryUrl",
    "duration",
    "epoch",
    "expiresAt",
    "kind",
    "maxBytes",
    "mediaSequenceNumber",
    "objectKey",
    "renditionId",
    "sessionId",
    "slotId",
    "state"
  ],
  "title": "OLOS UploadSlot",
  "type": "object"
}
```
